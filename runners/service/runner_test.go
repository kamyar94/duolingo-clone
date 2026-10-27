package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testConfig(languages ...string) *Config {
	return &Config{
		Token: strings.Repeat("t", 32), Languages: languages, ScratchRoot: os.TempDir(),
		MaxRunMs: 20000, CompileMs: 30000, OutputLimit: 1024, QueueSize: 2,
		QueueWait: time.Second, FileSizeLimit: 1 << 20, OpenFiles: 64, MaxRuns: 3, MaxBody: 1 << 20,
	}
}

func TestValidateAcceptsAndFillsDefaults(t *testing.T) {
	cfg := testConfig("c")
	req := Request{Language: "c", Files: []File{{Name: "main.c", Content: "int main(){}"}}}
	plan, err := validate(cfg, &req)
	if err != nil {
		t.Fatal(err)
	}
	if req.TimeLimitMs != defaultRunLimit || len(req.Runs) != 1 {
		t.Fatalf("defaults not filled: %+v", req)
	}
	if plan.Compile[0] != "gcc" || plan.Run[0] != "./main" {
		t.Fatalf("unexpected plan %+v", plan)
	}
}

func TestValidateRefuses(t *testing.T) {
	cfg := testConfig("c", "csharp")
	cases := map[string]Request{
		"language not served":  {Language: "rust", Files: []File{{Name: "main.rs"}}},
		"no files":             {Language: "c"},
		"path in name":         {Language: "c", Files: []File{{Name: "../main.c"}}},
		"slash in name":        {Language: "c", Files: []File{{Name: "a/main.c"}}},
		"wrong extension":      {Language: "c", Files: []File{{Name: "main.py"}}},
		"duplicate":            {Language: "c", Files: []File{{Name: "main.c"}, {Name: "MAIN.c"}}},
		"nul byte":             {Language: "c", Files: []File{{Name: "main.c", Content: "a\x00b"}}},
		"too large":            {Language: "c", Files: []File{{Name: "main.c", Content: strings.Repeat("x", maxSourceBytes+1)}}},
		"too many runs":        {Language: "c", Files: []File{{Name: "main.c"}}, Runs: make([]RunInput, 4)},
		"large stdin":          {Language: "c", Files: []File{{Name: "main.c"}}, Runs: []RunInput{{Stdin: strings.Repeat("x", maxStdinBytes+1)}}},
		"reserved C# name":     {Language: "csharp", Files: []File{{Name: "GlobalUsings.g.cs"}}},
		"hidden file":          {Language: "c", Files: []File{{Name: ".c"}}},
		"extension only":       {Language: "c", Files: []File{{Name: "x.c"}, {Name: "y.txt"}}},
		"many files":           {Language: "c", Files: make([]File, maxFiles+1)},
		"name with a space":    {Language: "c", Files: []File{{Name: "my main.c"}}},
		"name starting with -": {Language: "c", Files: []File{{Name: "-o.c"}}},
	}
	for name, req := range cases {
		if _, err := validate(cfg, &req); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestValidateClampsTimeLimit(t *testing.T) {
	cfg := testConfig("c")
	req := Request{Language: "c", Files: []File{{Name: "main.c"}}, TimeLimitMs: 999999}
	if _, err := validate(cfg, &req); err != nil || req.TimeLimitMs != cfg.MaxRunMs {
		t.Fatalf("limit %d, err %v", req.TimeLimitMs, err)
	}
	req.TimeLimitMs = 5
	if _, err := validate(cfg, &req); err != nil || req.TimeLimitMs != minRunLimit {
		t.Fatalf("limit %d, err %v", req.TimeLimitMs, err)
	}
}

func TestCaptureStopsAtLimit(t *testing.T) {
	calls := 0
	c := &capture{limit: 10, onLimit: func() { calls++ }}
	var out, errOut bytes.Buffer
	c.add(&out, []byte("12345678"))
	c.add(&errOut, []byte("abcdef"))
	c.add(&out, []byte("more"))
	if out.String() != "12345678" || errOut.String() != "ab" || !c.truncated || calls != 1 {
		t.Fatalf("out %q err %q truncated %v calls %d", out.String(), errOut.String(), c.truncated, calls)
	}
}

func TestScrubHidesScratchPath(t *testing.T) {
	result := StepResult{Stderr: "panic at /tmp/lingo-run-1/main.go:7\ncwd /tmp/lingo-run-1"}
	scrub(&result, "/tmp/lingo-run-1")
	if result.Stderr != "panic at main.go:7\ncwd ." {
		t.Fatalf("got %q", result.Stderr)
	}
}

func TestChildEnvIsClean(t *testing.T) {
	t.Setenv("RUNNER_TOKEN", "secret-token-value")
	t.Setenv("LINGO_CHILD_JAVA_OPTS", "-Xmx64m -Dhome={dir}")
	t.Setenv("JAVA_HOME", "/opt/java")
	env := strings.Join(childEnv(languages["java"], "/tmp/x"), "\n")
	if strings.Contains(env, "secret-token-value") {
		t.Fatal("the token reached the program")
	}
	for _, want := range []string{"HOME=/tmp/x", "TMPDIR=/tmp/x/tmp", "JAVA_OPTS=-Xmx64m -Dhome=/tmp/x", "JAVA_HOME=/opt/java"} {
		if !strings.Contains(env, want) {
			t.Errorf("missing %s in %s", want, env)
		}
	}
}

func TestJavaFileNamedAfterPublicClass(t *testing.T) {
	plan, err := planJava([]File{{Name: "Main.java", Content: "// public class Wrong {}\npublic final class Greeter {\n public static void main(String[] a) {}\n}\n"}})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Files[0].Name != "Greeter.java" || plan.Compile[len(plan.Compile)-1] != "Greeter.java" {
		t.Fatalf("got %+v", plan.Files)
	}
}

func TestJavaMainClass(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "out"), 0o700); err != nil {
		t.Fatal(err)
	}
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, "out", name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("Helper.class", "\x00\x06helper")
	write("Program.class", "xx\x00\x04mainyy")
	files := []File{{Name: "Main.java", Content: "class Helper {}\nclass Program { static void main(String[] a) {} }\n"}}
	if got := javaMainClass(dir, files); got != "Program" {
		t.Fatalf("got %s", got)
	}
	if got := javaMainClass(dir, []File{{Name: "Main.java", Content: "void main() {}"}}); got != "Main" {
		t.Fatalf("compact source file: got %s", got)
	}
}

func TestQueueRunsInOrderAndRefusesWhenFull(t *testing.T) {
	q := newQueue(2)
	if _, err := q.acquire(context.Background(), time.Second); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var order []int
	var wg sync.WaitGroup
	for i := 1; i <= 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			if _, err := q.acquire(context.Background(), 2*time.Second); err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			order = append(order, n)
			mu.Unlock()
			q.release()
		}(i)
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := q.acquire(context.Background(), time.Second); err != errBusy {
		t.Fatalf("third waiter: %v", err)
	}
	q.release()
	wg.Wait()
	if len(order) != 2 || order[0] != 1 || order[1] != 2 {
		t.Fatalf("order %v", order)
	}
}
