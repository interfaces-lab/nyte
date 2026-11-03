package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

type listenFunc func(ctx context.Context, node *tsnet.Server, client *local.Client, st *ipnstate.Status) (net.Listener, error)

var states = map[string]string{
	ipn.NoState.String():          "starting",
	ipn.Starting.String():         "starting",
	ipn.NeedsLogin.String():       "needs_login",
	ipn.NeedsMachineAuth.String(): "needs_machine_approval",
	ipn.Running.String():          "running",
	ipn.Stopped.String():          "stopped",
}

func run(ctx context.Context, opts options, authKey string, out io.Writer, listen listenFunc) error {
	report := newReporter(out, opts.access, opts.tags)
	node := newNode(opts, authKey)
	defer node.Close()

	if err := node.Start(); err != nil {
		return err
	}

	client, err := node.LocalClient()
	if err != nil {
		return err
	}

	watcher, err := client.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		return err
	}
	defer watcher.Close()

	gate := newGate(client, opts)
	server := &http.Server{Handler: gate, ConnContext: gate.connContext}
	var serving sync.Once
	var served sync.WaitGroup

	for {
		if _, err := watcher.Next(); err != nil {
			if ctx.Err() != nil {
				break
			}
			return err
		}

		st, err := client.StatusWithoutPeers(ctx)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			return err
		}

		gate.observe(st)
		report.observe(st)

		if st.BackendState == ipn.Running.String() {
			serving.Do(func() {
				served.Go(func() {
					serve(ctx, server, report, func() (net.Listener, error) { return listen(ctx, node, client, st) })
				})
			})
		}
	}

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(shutdown)
	served.Wait()
	report.update(func(now *status) { now.State = "stopped" })

	return nil
}

func serve(ctx context.Context, server *http.Server, report *reporter, listen func() (net.Listener, error)) {
	listener, err := listen()
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("serving HTTPS: %v", err)
		}
		report.update(func(now *status) { now.HTTPS = "unavailable" })
		return
	}

	report.update(func(now *status) { now.HTTPS = "available" })

	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("serving: %v", err)
	}
}

func listenTLS(ctx context.Context, node *tsnet.Server, client *local.Client, st *ipnstate.Status) (net.Listener, error) {
	if st.CurrentTailnet == nil || !st.CurrentTailnet.MagicDNSEnabled {
		return nil, errors.New("MagicDNS is off for this tailnet")
	}

	if len(st.CertDomains) == 0 {
		return nil, errors.New("HTTPS certificates are off for this tailnet")
	}

	fetch, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	if _, _, err := client.CertPair(fetch, st.CertDomains[0]); err != nil {
		return nil, fmt.Errorf("getting a certificate for %s: %w", st.CertDomains[0], err)
	}

	return node.ListenTLS("tcp", ":443")
}

func dnsName(st *ipnstate.Status) string {
	if st.Self == nil {
		return ""
	}

	return strings.TrimSuffix(st.Self.DNSName, ".")
}
