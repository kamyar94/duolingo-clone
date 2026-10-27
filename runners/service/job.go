package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// RunInput is one run of the compiled program, with its own standard input.
type RunInput struct {
	Stdin string `json:"stdin"`
}

// Request is the body of POST /run.
type Request struct {
	Language    string     `json:"language"`
	Files       []File     `json:"files"`
	Runs        []RunInput `json:"runs"`
	TimeLimitMs int        `json:"timeLimitMs"`
}

// Response is the answer to POST /run. Compile is absent for interpreted languages; Runs is
// empty when the compile step failed.
type Response struct {
	Language string       `json:"language"`
	Compile  *StepResult  `json:"compile,omitempty"`
	Runs     []StepResult `json:"runs"`
	QueueMs  int64        `json:"queueMs"`
}

const (
	maxFiles        = 8
	maxSourceBytes  = 256 << 10
	maxStdinBytes   = 64 << 10
	maxStdinTotal   = 256 << 10
	defaultRunLimit = 3000
	minRunLimit     = 100
)

var fileNamePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$`)

// validate checks a request against the runner's languages and limits, fills in defaults and
// returns the plan for the job.
func validate(cfg *Config, req *Request) (Plan, error) {
	if !cfg.serves(req.Language) {
		return Plan{}, fmt.Errorf("this runner does not run %q", req.Language)
	}
	lang := languages[req.Language]
	if len(req.Files) == 0 || len(req.Files) > maxFiles {
		return Plan{}, fmt.Errorf("a program has 1 to %d files", maxFiles)
	}
	seen := map[string]bool{}
	total := 0
	for _, file := range req.Files {
		if !fileNamePattern.MatchString(file.Name) || strings.Contains(file.Name, "..") {
			return Plan{}, fmt.Errorf("the file name %q is not allowed", file.Name)
		}
		lower := strings.ToLower(file.Name)
		if seen[lower] {
			return Plan{}, fmt.Errorf("the file name %q appears twice", file.Name)
		}
		seen[lower] = true
		if !hasExt(file.Name, lang.Ext) {
			return Plan{}, fmt.Errorf("%s files end in %s", req.Language, strings.Join(lang.Ext, ", "))
		}
		if !utf8.ValidString(file.Content) || strings.ContainsRune(file.Content, 0) {
			return Plan{}, fmt.Errorf("the file %s is not text", file.Name)
		}
		total += len(file.Content)
	}
	if total > maxSourceBytes {
		return Plan{}, fmt.Errorf("the program is larger than %d KB", maxSourceBytes>>10)
	}
	if len(req.Runs) == 0 {
		req.Runs = []RunInput{{}}
	}
	if len(req.Runs) > cfg.MaxRuns {
		return Plan{}, fmt.Errorf("at most %d runs per request", cfg.MaxRuns)
	}
	stdinTotal := 0
	for _, run := range req.Runs {
		if len(run.Stdin) > maxStdinBytes {
			return Plan{}, fmt.Errorf("an input is larger than %d KB", maxStdinBytes>>10)
		}
		stdinTotal += len(run.Stdin)
	}
	if stdinTotal > maxStdinTotal {
		return Plan{}, fmt.Errorf("the inputs are larger than %d KB together", maxStdinTotal>>10)
	}
	switch {
	case req.TimeLimitMs == 0:
		req.TimeLimitMs = defaultRunLimit
	case req.TimeLimitMs < minRunLimit:
		req.TimeLimitMs = minRunLimit
	}
	if req.TimeLimitMs > cfg.MaxRunMs {
		req.TimeLimitMs = cfg.MaxRunMs
	}
	if req.TimeLimitMs < 0 {
		return Plan{}, errors.New("the time limit is negative")
	}
	return lang.Plan(req.Files)
}

func hasExt(name string, exts []string) bool {
	for _, ext := range exts {
		if strings.HasSuffix(name, ext) && len(name) > len(ext) {
			return true
		}
	}
	return false
}

// childEnv is the whole environment of a step. Nothing of the service's own environment reaches
// the program except PATH, the variables the language passes on and LINGO_CHILD_* settings of
// the image (LINGO_CHILD_JAVA_OPTS becomes JAVA_OPTS).
func childEnv(lang Language, dir string) []string {
	env := []string{
		"PATH=" + envOr("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
		"HOME=" + dir,
		"TMPDIR=" + filepath.Join(dir, "tmp"),
		"LANG=C.UTF-8",
		"LC_ALL=C.UTF-8",
		"USER=runner",
		"TERM=dumb",
	}
	for _, name := range lang.Pass {
		if value, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+value)
		}
	}
	for _, item := range lang.Env {
		env = append(env, strings.ReplaceAll(item, "{dir}", dir))
	}
	for _, item := range os.Environ() {
		if rest, ok := strings.CutPrefix(item, "LINGO_CHILD_"); ok && strings.Contains(rest, "=") {
			env = append(env, strings.ReplaceAll(rest, "{dir}", dir))
		}
	}
	return env
}

// runJob compiles and runs one request in a fresh scratch folder and removes every trace of it
// afterwards. Only one job runs at a time (see queue).
func (s *Server) runJob(ctx context.Context, req *Request, plan Plan) (Response, error) {
	resp := Response{Language: req.Language, Runs: []StepResult{}}
	lang := languages[req.Language]
	defer s.cleanup()

	dir, err := os.MkdirTemp(s.cfg.ScratchRoot, "lingo-run-")
	if err != nil {
		return resp, fmt.Errorf("no scratch folder: %w", err)
	}
	if err := os.Mkdir(filepath.Join(dir, "tmp"), 0o700); err != nil {
		return resp, fmt.Errorf("no scratch folder: %w", err)
	}
	for _, file := range plan.Files {
		if err := os.WriteFile(filepath.Join(dir, file.Name), []byte(file.Content), 0o600); err != nil {
			return resp, fmt.Errorf("cannot write %s: %w", file.Name, err)
		}
	}
	env := childEnv(lang, dir)

	if plan.Prepare != nil {
		if err := plan.Prepare(dir); err != nil {
			return resp, fmt.Errorf("cannot prepare the build: %w", err)
		}
	}
	if plan.Compile != nil {
		limit := s.cfg.CompileMs
		if plan.CompileMs > limit {
			limit = plan.CompileMs
		}
		result := execute(ctx, Step{
			Argv:        plan.Compile,
			Env:         env,
			Dir:         dir,
			Limit:       time.Duration(limit) * time.Millisecond,
			OutputLimit: s.cfg.OutputLimit,
			FileLimit:   512 << 20,
			OpenFiles:   4096,
		})
		scrub(&result, dir)
		resp.Compile = &result
		if result.ExitCode != 0 || result.TimedOut || result.Cancelled {
			return resp, nil
		}
	}

	run := plan.Run
	if plan.RunAfterCompile != nil {
		run = plan.RunAfterCompile(dir)
	}
	for _, input := range req.Runs {
		if ctx.Err() != nil {
			break
		}
		result := execute(ctx, Step{
			Argv:        run,
			Env:         env,
			Dir:         dir,
			Stdin:       input.Stdin,
			Limit:       time.Duration(req.TimeLimitMs) * time.Millisecond,
			OutputLimit: s.cfg.OutputLimit,
			FileLimit:   s.cfg.FileSizeLimit,
			OpenFiles:   s.cfg.OpenFiles,
		})
		scrub(&result, dir)
		resp.Runs = append(resp.Runs, result)
	}
	return resp, nil
}

// cleanup stops every leftover process and empties every place a program can write, so the
// next job starts as if the container were new.
func (s *Server) cleanup() {
	killOthers(3 * time.Second)
	for _, root := range s.wipeDirs() {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			forceRemove(filepath.Join(root, entry.Name()))
		}
	}
}

func (s *Server) wipeDirs() []string {
	dirs := []string{s.cfg.ScratchRoot}
	for _, dir := range strings.Split(envOr("LINGO_RUNNER_WIPE", "/tmp,/dev/shm"), ",") {
		dir = strings.TrimSpace(dir)
		if dir != "" && dir != s.cfg.ScratchRoot {
			dirs = append(dirs, dir)
		}
	}
	return dirs
}

// forceRemove deletes a tree even when the program took away its own permissions on parts of it.
func forceRemove(path string) {
	if os.RemoveAll(path) == nil {
		return
	}
	_ = filepath.WalkDir(path, func(p string, entry os.DirEntry, err error) error {
		if entry != nil && entry.IsDir() {
			_ = os.Chmod(p, 0o700)
		}
		return nil
	})
	_ = os.Chmod(path, 0o700)
	_ = os.RemoveAll(path)
}
