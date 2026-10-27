package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds the runner settings. Everything comes from the environment, so one binary serves
// every runner image; each image names its languages in LINGO_RUNNER_LANGUAGES.
type Config struct {
	Addr        string
	Token       string
	Languages   []string
	ScratchRoot string
	// Wall-clock limit of one run of the learner's program (requests may ask for less).
	MaxRunMs int
	// Default wall-clock limit of the compile step; a language may raise it.
	CompileMs int
	// Bytes of stdout plus stderr kept per run or compile step before the program is stopped.
	OutputLimit int
	// Waiting requests beyond the one that runs, and how long one may wait.
	QueueSize int
	QueueWait time.Duration
	// Largest file the program may write (RLIMIT_FSIZE) and open files (RLIMIT_NOFILE).
	FileSizeLimit int64
	OpenFiles     uint64
	// Most runs (inputs) in one request.
	MaxRuns int
	// Largest request body.
	MaxBody int64
	// The runner exits when idle after this many jobs or this uptime; Docker restarts it fresh.
	MaxJobs   int
	MaxUptime time.Duration
}

func envInt(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s must be a whole number, got %q", name, raw)
	}
	return value, nil
}

func loadConfig() (*Config, error) {
	cfg := &Config{
		Addr:        envOr("LINGO_RUNNER_ADDR", ":8080"),
		Token:       os.Getenv("RUNNER_TOKEN"),
		ScratchRoot: envOr("LINGO_RUNNER_SCRATCH", "/tmp"),
	}
	// The token must not reach the learner's programs. They get a clean environment anyway, and
	// the process is marked non-dumpable, so /proc/1/environ is closed to them as well.
	_ = os.Unsetenv("RUNNER_TOKEN")
	if len(cfg.Token) < 24 {
		return nil, fmt.Errorf("RUNNER_TOKEN must be set to a random value of at least 24 characters")
	}

	for _, id := range strings.Split(os.Getenv("LINGO_RUNNER_LANGUAGES"), ",") {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := languages[id]; !ok {
			return nil, fmt.Errorf("LINGO_RUNNER_LANGUAGES names an unknown language %q", id)
		}
		cfg.Languages = append(cfg.Languages, id)
	}
	if len(cfg.Languages) == 0 {
		return nil, fmt.Errorf("LINGO_RUNNER_LANGUAGES must name at least one language")
	}

	ints := []struct {
		name     string
		target   *int
		fallback int
	}{
		{"LINGO_RUNNER_MAX_RUN_MS", &cfg.MaxRunMs, 20000},
		{"LINGO_RUNNER_COMPILE_MS", &cfg.CompileMs, 30000},
		{"LINGO_RUNNER_OUTPUT_LIMIT", &cfg.OutputLimit, 64 * 1024},
		{"LINGO_RUNNER_QUEUE", &cfg.QueueSize, 8},
		{"LINGO_RUNNER_MAX_RUNS", &cfg.MaxRuns, 20},
		{"LINGO_RUNNER_MAX_JOBS", &cfg.MaxJobs, 500},
	}
	for _, item := range ints {
		value, err := envInt(item.name, item.fallback)
		if err != nil {
			return nil, err
		}
		*item.target = value
	}
	queueWait, err := envInt("LINGO_RUNNER_QUEUE_WAIT_MS", 30000)
	if err != nil {
		return nil, err
	}
	cfg.QueueWait = time.Duration(queueWait) * time.Millisecond
	uptime, err := envInt("LINGO_RUNNER_MAX_UPTIME_MIN", 24*60)
	if err != nil {
		return nil, err
	}
	cfg.MaxUptime = time.Duration(uptime) * time.Minute
	fileMB, err := envInt("LINGO_RUNNER_FILE_LIMIT_MB", 32)
	if err != nil {
		return nil, err
	}
	cfg.FileSizeLimit = int64(fileMB) << 20
	openFiles, err := envInt("LINGO_RUNNER_OPEN_FILES", 256)
	if err != nil {
		return nil, err
	}
	cfg.OpenFiles = uint64(openFiles)
	bodyKB, err := envInt("LINGO_RUNNER_MAX_BODY_KB", 1024)
	if err != nil {
		return nil, err
	}
	cfg.MaxBody = int64(bodyKB) << 10

	if cfg.MaxRunMs < 100 || cfg.CompileMs < 1000 || cfg.OutputLimit < 1024 || cfg.MaxRuns < 1 {
		return nil, fmt.Errorf("limits are too small: run %d ms, compile %d ms, output %d bytes, runs %d",
			cfg.MaxRunMs, cfg.CompileMs, cfg.OutputLimit, cfg.MaxRuns)
	}
	return cfg, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func (c *Config) serves(language string) bool {
	for _, id := range c.Languages {
		if id == language {
			return true
		}
	}
	return false
}
