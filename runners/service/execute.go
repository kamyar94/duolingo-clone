package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// StepResult is the outcome of one compile step or one run of the program.
type StepResult struct {
	ExitCode   int    `json:"exitCode"`
	Signal     string `json:"signal,omitempty"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"durationMs"`
	TimedOut   bool   `json:"timedOut"`
	Truncated  bool   `json:"truncated"`
	OOMKilled  bool   `json:"oomKilled"`
	Cancelled  bool   `json:"cancelled,omitempty"`
}

// Step is one process to run in the scratch folder.
type Step struct {
	Argv        []string
	Env         []string
	Dir         string
	Stdin       string
	Limit       time.Duration
	OutputLimit int
	FileLimit   int64
	OpenFiles   uint64
}

// capture keeps stdout and stderr up to one shared limit and calls onLimit once when the program
// prints more.
type capture struct {
	mu        sync.Mutex
	limit     int
	used      int
	truncated bool
	onLimit   func()
	once      sync.Once
}

func (c *capture) add(into *bytes.Buffer, chunk []byte) {
	c.mu.Lock()
	room := c.limit - c.used
	over := len(chunk) > room
	if over {
		chunk = chunk[:max(room, 0)]
		c.truncated = true
	}
	into.Write(chunk)
	c.used += len(chunk)
	c.mu.Unlock()
	if over && c.onLimit != nil {
		c.once.Do(c.onLimit)
	}
}

func (c *capture) drain(r io.Reader, into *bytes.Buffer) {
	buf := make([]byte, 32<<10)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			c.add(into, buf[:n])
		}
		if err != nil {
			return
		}
	}
}

// execute runs one step through the launcher and enforces its time and output limits. When it
// returns, every process the step started is gone.
func execute(ctx context.Context, step Step) StepResult {
	self, err := os.Executable()
	if err != nil {
		return StepResult{ExitCode: -1, Stderr: "the runner cannot find itself: " + err.Error()}
	}
	cpuSeconds := int(step.Limit/time.Second) + 5
	cmd := exec.Command(self, helperArgs(step.FileLimit, step.OpenFiles, cpuSeconds, step.Argv)...)
	cmd.Dir = step.Dir
	cmd.Env = step.Env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Own pipes rather than io.Writers, so Wait returns when the process ends even if a child
	// still holds the write ends; the sweep after Wait closes those.
	outR, outW, err := os.Pipe()
	if err != nil {
		return StepResult{ExitCode: -1, Stderr: "the runner has no pipes left: " + err.Error()}
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		outR.Close()
		outW.Close()
		return StepResult{ExitCode: -1, Stderr: "the runner has no pipes left: " + err.Error()}
	}
	inR, inW, err := os.Pipe()
	if err != nil {
		outR.Close()
		outW.Close()
		errR.Close()
		errW.Close()
		return StepResult{ExitCode: -1, Stderr: "the runner has no pipes left: " + err.Error()}
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = inR, outW, errW

	var reasonMu sync.Mutex
	reason := ""
	stop := func(why string) {
		reasonMu.Lock()
		if reason == "" {
			reason = why
		}
		reasonMu.Unlock()
		stopAll()
	}

	var stdout, stderr bytes.Buffer
	out := &capture{limit: step.OutputLimit, onLimit: func() { stop("truncated") }}
	oomBefore := oomKills()
	start := time.Now()
	startErr := cmd.Start()
	outW.Close()
	errW.Close()
	inR.Close()
	if startErr != nil {
		outR.Close()
		errR.Close()
		inW.Close()
		return StepResult{ExitCode: -1, Stderr: "the runner could not start the step: " + startErr.Error()}
	}

	var readers sync.WaitGroup
	readers.Add(2)
	go func() { defer readers.Done(); out.drain(outR, &stdout) }()
	go func() { defer readers.Done(); out.drain(errR, &stderr) }()
	go func() {
		_, _ = io.WriteString(inW, step.Stdin)
		inW.Close()
	}()

	timer := time.AfterFunc(step.Limit, func() { stop("timeout") })
	finished := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			stop("cancelled")
		case <-finished:
		}
	}()

	waitErr := cmd.Wait()
	elapsed := time.Since(start)
	timer.Stop()
	close(finished)
	// Background children of the program die with it, and their pipe ends close.
	killOthers(2 * time.Second)

	drained := make(chan struct{})
	go func() { readers.Wait(); close(drained) }()
	select {
	case <-drained:
	case <-time.After(2 * time.Second):
		outR.Close()
		errR.Close()
		<-drained
	}
	outR.Close()
	errR.Close()

	result := StepResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		DurationMs: elapsed.Milliseconds(),
	}
	var exitErr *exec.ExitError
	if waitErr != nil && !errors.As(waitErr, &exitErr) {
		result.ExitCode = -1
		result.Stderr += "\nthe runner lost the program: " + waitErr.Error()
	}
	if state := cmd.ProcessState; state != nil {
		if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			result.Signal = signalName(status.Signal())
			result.ExitCode = 128 + int(status.Signal())
		} else {
			result.ExitCode = state.ExitCode()
		}
	}
	reasonMu.Lock()
	switch reason {
	case "timeout":
		result.TimedOut = true
	case "truncated":
		result.Truncated = true
	case "cancelled":
		result.Cancelled = true
	}
	reasonMu.Unlock()
	out.mu.Lock()
	result.Truncated = result.Truncated || out.truncated
	out.mu.Unlock()
	if oomBefore >= 0 {
		if after := oomKills(); after > oomBefore {
			result.OOMKilled = true
		}
	}
	return result
}

// scrub hides the scratch folder's path in what the learner sees.
func scrub(result *StepResult, dir string) {
	replacer := strings.NewReplacer(dir+"/", "", dir, ".")
	result.Stdout = replacer.Replace(result.Stdout)
	result.Stderr = replacer.Replace(result.Stderr)
}
