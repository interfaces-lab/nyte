package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

const runMainVariable = "NYTE_TAILNET_TEST_RUN_MAIN"

func TestMain(m *testing.M) {
	if os.Getenv(runMainVariable) == "1" {
		main()
		os.Exit(0)
	}

	os.Exit(m.Run())
}

type process struct {
	cmd   *exec.Cmd
	lease io.WriteCloser
	lines chan map[string]any
	done  chan error
}

func TestOneNodePerStateDirectoryAndStdinIsItsLease(t *testing.T) {
	control := startControl(t)
	dir := filepath.Join(t.TempDir(), "state")
	host := startFakeHost(t)

	first := startProcess(t, dir, control.HTTPTestServer.URL, host.socket)
	expectLine(t, first, func(line map[string]any) bool { return line["state"] == "starting" })

	data, err := os.ReadFile(filepath.Join(dir, lockName))
	if err != nil {
		t.Fatal(err)
	}
	var held lockHolder
	if err := json.Unmarshal(data, &held); err != nil {
		t.Fatalf("the lock file holds %q: %v", data, err)
	}
	if held.PID != first.cmd.Process.Pid || held.Instance == "" {
		t.Fatalf("the lock file holds %+v, not pid %d with an instance id", held, first.cmd.Process.Pid)
	}

	started := time.Now()
	second := startProcess(t, dir, control.HTTPTestServer.URL, host.socket)
	expectLine(t, second, func(line map[string]any) bool {
		return line["state"] == "stopped" && line["reason"] == "locked" && line["holder"] == float64(first.cmd.Process.Pid)
	})

	select {
	case err := <-second.done:
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			t.Fatalf("the second instance ended with %v, not exit code 1", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the second instance kept running beside the first")
	}
	if waited := time.Since(started); waited > 5*time.Second {
		t.Fatalf("the second instance took %v to give up", waited)
	}

	closed := time.Now()
	first.lease.Close()

	select {
	case <-first.done:
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("the node kept running after stdin closed")
	}
	if took := time.Since(closed); took > 1200*time.Millisecond {
		t.Fatalf("the node took %v to stop after stdin closed", took)
	}
}

func startProcess(t *testing.T, dir, controlURL, socket string) *process {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, os.Args[0], "--dir", dir, "--socket", socket, "--hostname", "locked", "--control-url", controlURL)
	cmd.Env = append(os.Environ(), runMainVariable+"=1", "TS_NO_LOGS_NO_SUPPORT=true")

	lease, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}

	running := &process{cmd: cmd, lease: lease, lines: make(chan map[string]any, 64), done: make(chan error, 1)}

	go func() {
		scanner := bufio.NewScanner(out)
		for scanner.Scan() {
			var line map[string]any
			if json.Unmarshal(scanner.Bytes(), &line) != nil {
				continue
			}
			select {
			case running.lines <- line:
			default:
			}
		}
		close(running.lines)
		running.done <- cmd.Wait()
	}()

	t.Cleanup(func() {
		cancel()
		lease.Close()
	})

	return running
}

func expectLine(t *testing.T, running *process, match func(map[string]any) bool) {
	t.Helper()

	timeout := time.After(30 * time.Second)
	for {
		select {
		case line, open := <-running.lines:
			if !open {
				t.Fatal("the process ended before the expected status")
			}
			if match(line) {
				return
			}
		case <-timeout:
			t.Fatal("no status matched")
		}
	}
}
