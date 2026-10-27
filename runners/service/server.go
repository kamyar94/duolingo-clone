package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

var errBusy = errors.New("busy")

// queue lets one job run at a time. Others wait in arrival order (Go wakes blocked channel
// senders first in, first out), up to a number of waiting requests and a waiting time.
type queue struct {
	slot    chan struct{}
	waiting atomic.Int64
	max     int64
}

func newQueue(size int) *queue {
	return &queue{slot: make(chan struct{}, 1), max: int64(size)}
}

func (q *queue) acquire(ctx context.Context, wait time.Duration) (time.Duration, error) {
	start := time.Now()
	select {
	case q.slot <- struct{}{}:
		return 0, nil
	default:
	}
	if q.waiting.Add(1) > q.max {
		q.waiting.Add(-1)
		return 0, errBusy
	}
	defer q.waiting.Add(-1)
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case q.slot <- struct{}{}:
		return time.Since(start), nil
	case <-timer.C:
		return 0, errBusy
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

func (q *queue) tryAcquire() bool {
	select {
	case q.slot <- struct{}{}:
		return true
	default:
		return false
	}
}

func (q *queue) release() { <-q.slot }

// Server answers the Lingo app.
type Server struct {
	cfg     *Config
	queue   *queue
	jobs    atomic.Int64
	running atomic.Bool
	started time.Time
}

func newServer(cfg *Config) *Server {
	return &Server{cfg: cfg, queue: newQueue(cfg.QueueSize), started: time.Now()}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /run", s.handleRun)
	mux.HandleFunc("GET /health", s.handleHealth)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) authorized(r *http.Request) bool {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && subtle.ConstantTimeCompare([]byte(token), []byte(s.cfg.Token)) == 1
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"languages": s.cfg.Languages,
		"running":   s.running.Load(),
		"waiting":   s.queue.waiting.Load(),
	})
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "send JSON"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req Request
	if err := decoder.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "the request is too large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the request is not valid JSON for a run"})
		return
	}
	plan, err := validate(s.cfg, &req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	waited, err := s.queue.acquire(r.Context(), s.cfg.QueueWait)
	if errors.Is(err, errBusy) {
		w.Header().Set("Retry-After", "3")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
		return
	}
	if err != nil {
		return // the app gave up waiting
	}
	s.running.Store(true)
	start := time.Now()
	resp, jobErr := s.runJob(r.Context(), &req, plan)
	s.running.Store(false)
	s.jobs.Add(1)
	s.queue.release()

	compileMs, runs := int64(0), len(resp.Runs)
	if resp.Compile != nil {
		compileMs = resp.Compile.DurationMs
	}
	if jobErr != nil {
		log.Printf("job %s failed after %d ms: %v", req.Language, time.Since(start).Milliseconds(), jobErr)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "the runner could not run the program"})
		return
	}
	// The log names the language and the timings only, never the code or its output.
	log.Printf("job %s: waited %d ms, compile %d ms, %d run(s), total %d ms",
		req.Language, waited.Milliseconds(), compileMs, runs, time.Since(start).Milliseconds())
	resp.QueueMs = waited.Milliseconds()
	writeJSON(w, http.StatusOK, resp)
}

// recycle ends the service when it is idle and has served enough jobs or run long enough. Docker
// starts the container again with an empty scratch folder.
func (s *Server) recycle() {
	if s.cfg.MaxJobs == 0 && s.cfg.MaxUptime == 0 {
		return
	}
	for range time.Tick(30 * time.Second) {
		due := (s.cfg.MaxJobs > 0 && s.jobs.Load() >= int64(s.cfg.MaxJobs)) ||
			(s.cfg.MaxUptime > 0 && time.Since(s.started) >= s.cfg.MaxUptime)
		if !due || s.queue.waiting.Load() > 0 || !s.queue.tryAcquire() {
			continue
		}
		log.Printf("recycling after %d jobs and %s", s.jobs.Load(), time.Since(s.started).Round(time.Second))
		s.cleanup()
		exitService(0)
	}
}
