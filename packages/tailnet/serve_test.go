package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

type idleListener struct {
	closed chan struct{}
	once   sync.Once
}

func TestServeListensAgainWithBackoffUntilShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		lines := &statusLines{}
		server := &http.Server{Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
		listener := &idleListener{closed: make(chan struct{})}
		var attempts atomic.Int32
		done := make(chan struct{})

		go func() {
			defer close(done)
			serve(ctx, server, newReporter(lines, "owner", nil), func() (net.Listener, error) {
				if attempts.Add(1) < 3 {
					return nil, errors.New("HTTPS certificates are off for this tailnet")
				}
				return listener, nil
			})
		}()

		expectAttempts := func(want int32, https string) {
			t.Helper()
			synctest.Wait()
			all := lines.all()
			if got := attempts.Load(); got != want || all[len(all)-1].HTTPS != https {
				t.Fatalf("after %d listens HTTPS is %q; want %d listens and %q", got, all[len(all)-1].HTTPS, want, https)
			}
		}

		expectAttempts(1, "unavailable")
		time.Sleep(firstListenRetry)
		expectAttempts(2, "unavailable")
		time.Sleep(2*firstListenRetry - time.Second)
		expectAttempts(2, "unavailable")
		time.Sleep(time.Second)
		expectAttempts(3, "available")

		cancel()
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}
		<-done
	})
}

func (l *idleListener) Accept() (net.Conn, error) {
	<-l.closed
	return nil, net.ErrClosed
}

func (l *idleListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *idleListener) Addr() net.Addr {
	return &net.TCPAddr{}
}
