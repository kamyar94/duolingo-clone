//go:build linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// execHelperArg makes the binary act as a tiny launcher: it lowers its own limits, offers itself
// first to the out-of-memory killer and then replaces itself with the learner's command. Go
// cannot set resource limits for a child directly, so every step starts through this helper.
const execHelperArg = "__lingo_exec"

const (
	prSetDumpable       = 4
	prSetChildSubreaper = 36
)

// ignoredSignals keep the service alive when a program signals every process it can reach. As
// process 1 of the container the service then gets only the signals it handles.
var ignoredSignals = []os.Signal{
	syscall.SIGHUP, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGTERM, syscall.SIGABRT,
	syscall.SIGUSR1, syscall.SIGUSR2, syscall.SIGALRM, syscall.SIGXCPU, syscall.SIGXFSZ,
}

// protectService runs once at start. Non-dumpable closes /proc/<pid>/environ, mem and friends to
// programs of the same user; as a subreaper the service collects every orphaned process.
func protectService() {
	if _, _, errno := syscall.RawSyscall(syscall.SYS_PRCTL, prSetDumpable, 0, 0); errno != 0 {
		fmt.Fprintf(os.Stderr, "lingo-runner: cannot mark the service non-dumpable: %v\n", errno)
		os.Exit(1)
	}
	_, _, _ = syscall.RawSyscall(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0)
	signal.Ignore(ignoredSignals...)
}

// warmThreads makes the Go runtime start a few spare threads while the container still has room.
// A fork bomb fills the process limit of the container, and the service must not need a new
// thread to stop it.
func warmThreads(count int) {
	done := make(chan struct{})
	for i := 0; i < count; i++ {
		go func() {
			ts := syscall.Timespec{Nsec: 30 * int64(time.Millisecond)}
			_ = syscall.Nanosleep(&ts, nil)
			done <- struct{}{}
		}()
	}
	for i := 0; i < count; i++ {
		<-done
	}
}

// helperArgs builds the launcher command line for one step.
func helperArgs(fileLimit int64, openFiles uint64, cpuSeconds int, argv []string) []string {
	return append([]string{
		execHelperArg,
		strconv.FormatInt(fileLimit, 10),
		strconv.FormatUint(openFiles, 10),
		strconv.Itoa(cpuSeconds),
		"--",
	}, argv...)
}

// execHelper is the launcher side of helperArgs. It never returns.
func execHelper(args []string) {
	fail := func(format string, values ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", values...)
		os.Exit(127)
	}
	if len(args) < 5 || args[3] != "--" {
		fail("lingo-runner: bad launcher arguments")
	}
	fileLimit, err1 := strconv.ParseUint(args[0], 10, 64)
	openFiles, err2 := strconv.ParseUint(args[1], 10, 64)
	cpu, err3 := strconv.ParseUint(args[2], 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		fail("lingo-runner: bad launcher limits")
	}
	limits := []struct {
		resource  int
		soft, max uint64
	}{
		{syscall.RLIMIT_CORE, 0, 0},
		{syscall.RLIMIT_FSIZE, fileLimit, fileLimit},
		{syscall.RLIMIT_NOFILE, openFiles, openFiles},
	}
	if cpu > 0 {
		limits = append(limits, struct {
			resource  int
			soft, max uint64
		}{syscall.RLIMIT_CPU, cpu, cpu + 1})
	}
	for _, limit := range limits {
		if err := syscall.Setrlimit(limit.resource, &syscall.Rlimit{Cur: limit.soft, Max: limit.max}); err != nil {
			fail("lingo-runner: cannot set a limit: %v", err)
		}
	}
	// Raising one's own score needs no privilege; the program goes first when memory runs out.
	_ = os.WriteFile("/proc/self/oom_score_adj", []byte("1000"), 0)

	argv := args[4:]
	path, err := exec.LookPath(argv[0])
	if err != nil {
		fail("cannot start %s: %v", argv[0], err)
	}
	resetSignals()
	err = syscall.Exec(path, argv, os.Environ())
	fail("cannot start %s: %v", argv[0], err)
}

// resetSignals restores the default action of every signal, because ignored signals would stay
// ignored in the learner's program after exec.
func resetSignals() {
	var action [4]uint64 // handler SIG_DFL, no flags, no restorer, empty mask
	for sig := 1; sig < 32; sig++ {
		if sig == int(syscall.SIGKILL) || sig == int(syscall.SIGSTOP) {
			continue
		}
		_, _, _ = syscall.RawSyscall6(syscall.SYS_RT_SIGACTION, uintptr(sig),
			uintptr(unsafe.Pointer(&action[0])), 0, 8, 0, 0)
	}
}

// killOthers stops every other process of the container that the service may signal: the
// learner's program, its children and anything that left the process group with setsid. Then it
// collects their exit states so the process limit is free again.
func killOthers(wait time.Duration) {
	self := os.Getpid()
	uid := os.Getuid()
	deadline := time.Now().Add(wait)
	for {
		_ = syscall.Kill(-1, syscall.SIGKILL)
		reap()
		if !othersAlive(self, uid) || time.Now().After(deadline) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// stopAll is the quick form used when a limit is hit while the step still runs; the step's own
// Wait collects the exit state of its process.
func stopAll() {
	_ = syscall.Kill(-1, syscall.SIGKILL)
}

func reap() {
	for {
		var status syscall.WaitStatus
		pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
		if pid <= 0 || err != nil {
			return
		}
	}
}

// othersAlive reports whether a process of the same user other than the service still exists.
func othersAlive(self, uid int) bool {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return false
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == self || pid == 1 {
			continue
		}
		if processUID(pid) == uid {
			return true
		}
	}
	return false
}

func processUID(pid int) int {
	file, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		return -1
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && fields[0] == "Uid:" {
			uid, err := strconv.Atoi(fields[1])
			if err != nil {
				return -1
			}
			return uid
		}
	}
	return -1
}

// oomKills reads the container's count of processes killed for lack of memory (cgroup v2 or
// v1), or -1 when it cannot be read.
func oomKills() int64 {
	for _, path := range []string{"/sys/fs/cgroup/memory.events", "/sys/fs/cgroup/memory/memory.oom_control"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == "oom_kill" {
				if count, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
					return count
				}
			}
		}
	}
	return -1
}

// signalName gives a short name for a signal that ended a program.
func signalName(sig syscall.Signal) string {
	switch sig {
	case syscall.SIGKILL:
		return "SIGKILL"
	case syscall.SIGSEGV:
		return "SIGSEGV"
	case syscall.SIGABRT:
		return "SIGABRT"
	case syscall.SIGFPE:
		return "SIGFPE"
	case syscall.SIGBUS:
		return "SIGBUS"
	case syscall.SIGILL:
		return "SIGILL"
	case syscall.SIGXCPU:
		return "SIGXCPU"
	case syscall.SIGXFSZ:
		return "SIGXFSZ"
	case syscall.SIGPIPE:
		return "SIGPIPE"
	case syscall.SIGTERM:
		return "SIGTERM"
	case syscall.SIGTRAP:
		return "SIGTRAP"
	case syscall.SIGSYS:
		return "SIGSYS"
	}
	return fmt.Sprintf("signal %d", int(sig))
}
