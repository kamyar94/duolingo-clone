// Command lingo-runner is the server-side code runner of Lingo (docs/DESIGN-coding-and-math.md,
// section 4.4). One runner image per language family carries this binary next to the official
// toolchain of its languages. The Lingo app sends a program over a private network; the runner
// compiles it and runs it as a separate process in a fresh scratch folder, one job at a time,
// with limits on time, output, file size and open files, stops every process the program
// started, deletes the folder and answers with the output, exit codes and timings.
//
// The container settings (deploy/docker-compose.yml) do the rest of the isolation: no
// capabilities, no new privileges, a non-root user, a read-only root file system, limits on
// memory, processes and CPU, and a network without a route to the internet.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

func exitService(code int) { os.Exit(code) }

func main() {
	if len(os.Args) > 1 && os.Args[1] == execHelperArg {
		execHelper(os.Args[2:])
		return
	}
	log.SetFlags(log.LstdFlags | log.LUTC)
	log.SetPrefix("lingo-runner ")

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("not starting: %v", err)
	}
	if os.Getuid() == 0 && os.Getenv("LINGO_RUNNER_ALLOW_ROOT") != "1" {
		log.Fatalf("not starting: the runner must run as a non-root user")
	}
	protectService()
	if err := checkScratch(cfg.ScratchRoot); err != nil {
		log.Fatalf("not starting: %v", err)
	}
	warmThreads(8)

	for _, id := range cfg.Languages {
		plan, err := languages[id].Plan([]File{{Name: languages[id].Source, Content: ""}})
		if err != nil {
			continue
		}
		tool := plan.Run
		if plan.Compile != nil {
			tool = plan.Compile
		}
		if len(tool) > 0 && !strings.HasPrefix(tool[0], "./") {
			if _, err := exec.LookPath(tool[0]); err != nil {
				log.Printf("warning: %s needs %s, which is not on PATH", id, tool[0])
			}
		}
	}

	server := newServer(cfg)
	go server.recycle()
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	log.Printf("serving %s on %s (run limit %d ms, compile limit %d ms, output %d bytes, queue %d)",
		strings.Join(cfg.Languages, ", "), cfg.Addr, cfg.MaxRunMs, cfg.CompileMs, cfg.OutputLimit, cfg.QueueSize)
	log.Fatal(httpServer.ListenAndServe())
}

// checkScratch makes sure the scratch folder exists, is writable and starts empty.
func checkScratch(root string) error {
	probe, err := os.MkdirTemp(root, "lingo-probe-")
	if err != nil {
		return fmt.Errorf("the scratch folder %s is not writable: %w", root, err)
	}
	return os.Remove(probe)
}
