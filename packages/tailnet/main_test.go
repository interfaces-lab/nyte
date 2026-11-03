package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/ipn/store/mem"
	"tailscale.com/net/netns"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/key"
	"tailscale.com/types/logger"
)

type fakeHost struct {
	socket string
	mu     sync.Mutex
	seen   []string
}

type statusLines struct {
	mu    sync.Mutex
	lines []status
	rest  []byte
}

type sidecar struct {
	statuses *statusLines
	stop     context.CancelFunc
	done     chan struct{}
	err      error
}

func TestSidecarAdmitsByWhoIs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	control := startControl(t)
	controlURL := control.HTTPTestServer.URL
	host := startFakeHost(t)
	owned := startSidecar(t, ctx, controlURL, host.socket, "owned", "owner")
	open := startSidecar(t, ctx, controlURL, host.socket, "open", "tailnet")
	stranger, strangerKey := startClient(t, ctx, controlURL, "stranger")
	phone, phoneKey := startClient(t, ctx, controlURL, "phone")

	ownedNode := findNode(t, control, "owned")
	openNode := findNode(t, control, "open")
	ownedAddress := netip.AddrPortFrom(ownedNode.Addresses[0].Addr(), 80).String()
	openAddress := netip.AddrPortFrom(openNode.Addresses[0].Addr(), 80).String()

	reassigned := control.Node(phoneKey).Clone()
	reassigned.User = ownedNode.User
	control.UpdateNode(reassigned)

	strangerNode := control.Node(strangerKey)
	phoneNode := control.Node(phoneKey)

	expectStatus(t, owned, func(now status) bool {
		return now.State == "running" && now.HTTPS == "available" && now.Access == "owner" &&
			now.DNSName == "owned.tail-scale.ts.net"
	})

	expectStatus(t, open, func(now status) bool {
		return now.State == "running" && now.HTTPS == "available" && now.Access == "tailnet"
	})

	waitFor(t, func() error {
		response, body := get(ctx, phone, ownedAddress, "/owner", nil)
		if response != http.StatusOK {
			return fmt.Errorf("the owner got %d: %s", response, body)
		}
		return nil
	})

	if seen := host.last(t); !reflect.DeepEqual(seen, principalFor(phoneNode, ownedNode.User, true)) {
		t.Fatalf("the owner reached the host as %+v", seen)
	}

	status, body := get(ctx, stranger, ownedAddress, "/stranger", nil)
	if status != http.StatusForbidden || !strings.Contains(body, `"code":"denied"`) {
		t.Fatalf("owner mode answered another user with %d: %s", status, body)
	}

	if host.saw("/stranger") {
		t.Fatal("owner mode proxied another user's request to the host")
	}

	waitFor(t, func() error {
		response, body := get(ctx, stranger, openAddress, "/stranger", http.Header{principalHeader: {"forged"}})
		if response != http.StatusOK {
			return fmt.Errorf("tailnet mode answered another user with %d: %s", response, body)
		}
		return nil
	})

	if seen := host.last(t); !reflect.DeepEqual(seen, principalFor(strangerNode, strangerNode.User, false)) {
		t.Fatalf("another user reached the host as %+v", seen)
	}

	waitFor(t, func() error {
		response, body := get(ctx, phone, openAddress, "/phone", nil)
		if response != http.StatusOK {
			return fmt.Errorf("tailnet mode answered the owner with %d: %s", response, body)
		}
		return nil
	})

	if seen := host.last(t); !reflect.DeepEqual(seen, principalFor(phoneNode, ownedNode.User, false)) {
		t.Fatalf("the owner of another node reached the open host as %+v", seen)
	}

	echo := upgrade(t, ctx, stranger, openAddress)
	if echo != "ping" {
		t.Fatalf("the upgraded connection echoed %q", echo)
	}

	owned.stop()
	<-owned.done
	if owned.err != nil {
		t.Fatalf("the sidecar stopped with %v", owned.err)
	}

	lines := owned.statuses.all()
	if first := lines[0]; first.State != "starting" || first.HTTPS != "pending" {
		t.Fatalf("the first status was %+v", first)
	}
	if last := lines[len(lines)-1]; last.State != "stopped" {
		t.Fatalf("the last status was %+v", last)
	}
}

func startControl(t *testing.T) *testcontrol.Server {
	netns.SetEnabled(false)
	t.Cleanup(func() { netns.SetEnabled(true) })

	control := &testcontrol.Server{
		DERPMap:        integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1"),
		DNSConfig:      &tailcfg.DNSConfig{Proxied: true},
		MagicDNSDomain: "tail-scale.ts.net",
		Logf:           logger.Discard,
	}
	control.HTTPTestServer = httptest.NewUnstartedServer(control)
	control.HTTPTestServer.Start()
	t.Cleanup(control.HTTPTestServer.Close)

	return control
}

func startSidecar(t *testing.T, ctx context.Context, controlURL, socket, hostname, access string) *sidecar {
	ctx, stop := context.WithCancel(ctx)
	running := &sidecar{statuses: &statusLines{}, stop: stop, done: make(chan struct{})}
	opts := options{
		dir:        filepath.Join(t.TempDir(), hostname),
		hostname:   hostname,
		socket:     socket,
		access:     access,
		controlURL: controlURL,
		authKeyFD:  -1,
	}

	go func() {
		running.err = run(ctx, opts, "", running.statuses, listenPlain)
		close(running.done)
	}()

	t.Cleanup(func() {
		stop()
		<-running.done
	})

	expectStatus(t, running, func(now status) bool { return now.State == "running" })

	return running
}

func listenPlain(_ context.Context, node *tsnet.Server, _ *local.Client, _ *ipnstate.Status) (net.Listener, error) {
	return node.Listen("tcp", ":80")
}

func startClient(t *testing.T, ctx context.Context, controlURL, hostname string) (*tsnet.Server, key.NodePublic) {
	node := &tsnet.Server{
		Dir:        filepath.Join(t.TempDir(), hostname),
		Hostname:   hostname,
		ControlURL: controlURL,
		Store:      new(mem.Store),
		Ephemeral:  true,
		UserLogf:   logger.Discard,
	}
	t.Cleanup(func() { node.Close() })

	st, err := node.Up(ctx)
	if err != nil {
		t.Fatal(err)
	}

	return node, st.Self.PublicKey
}

func findNode(t *testing.T, control *testcontrol.Server, hostname string) *tailcfg.Node {
	for _, node := range control.AllNodes() {
		if node.Hostinfo.Hostname() == hostname {
			return node
		}
	}
	t.Fatalf("test control has no node named %s", hostname)
	return nil
}

func principalFor(node *tailcfg.Node, user tailcfg.UserID, owner bool) principal {
	tags := node.Tags
	if tags == nil {
		tags = []string{}
	}
	return principal{
		Kind:      "tailscale",
		UserID:    fmt.Sprint(int64(user)),
		LoginName: fmt.Sprintf("user-%d@fake-control.example.net", user),
		Node:      string(node.StableID),
		Tags:      tags,
		Owner:     owner,
	}
}

func get(ctx context.Context, from *tsnet.Server, address, path string, header http.Header) (int, string) {
	client := &http.Client{Transport: &http.Transport{DialContext: from.Dial, DisableKeepAlives: true}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+address+path, nil)
	if err != nil {
		return 0, err.Error()
	}
	for name, values := range header {
		request.Header[name] = values
	}

	response, err := client.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func upgrade(t *testing.T, ctx context.Context, from *tsnet.Server, address string) string {
	conn, err := from.Dial(ctx, "tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	fmt.Fprintf(conn, "GET /socket HTTP/1.1\r\nHost: %s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", address)
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("the upgrade answered %d", response.StatusCode)
	}

	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	echo := make([]byte, 4)
	if _, err := io.ReadFull(reader, echo); err != nil {
		t.Fatal(err)
	}
	return string(echo)
}

func startFakeHost(t *testing.T) *fakeHost {
	dir, err := os.MkdirTemp("", "nyte-tailnet-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })

	host := &fakeHost{socket: filepath.Join(dir, "host.sock")}
	listener, err := net.Listen("unix", host.socket)
	if err != nil {
		t.Fatal(err)
	}

	server := &http.Server{Handler: http.HandlerFunc(host.serve)}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })

	return host
}

func (h *fakeHost) serve(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.seen = append(h.seen, r.URL.Path+" "+r.Header.Get(principalHeader))
	h.mu.Unlock()

	if r.Header.Get("Upgrade") == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	conn, buffered, err := http.NewResponseController(w).Hijack()
	if err != nil {
		return
	}
	defer conn.Close()

	buffered.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	buffered.Flush()
	io.Copy(conn, buffered)
}

func (h *fakeHost) last(t *testing.T) principal {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.seen) == 0 {
		t.Fatal("the host saw no request")
	}

	_, encoded, _ := strings.Cut(h.seen[len(h.seen)-1], " ")
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("the principal header %q is not base64url: %v", encoded, err)
	}

	var found principal
	if err := json.Unmarshal(data, &found); err != nil {
		t.Fatalf("the principal header holds %s: %v", data, err)
	}
	return found
}

func (h *fakeHost) saw(path string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, entry := range h.seen {
		if strings.HasPrefix(entry, path+" ") {
			return true
		}
	}
	return false
}

func (s *statusLines) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.rest = append(s.rest, data...)
	for {
		line, rest, found := strings.Cut(string(s.rest), "\n")
		if !found {
			return len(data), nil
		}
		s.rest = []byte(rest)

		var now status
		if err := json.Unmarshal([]byte(line), &now); err != nil {
			return 0, err
		}
		s.lines = append(s.lines, now)
	}
}

func (s *statusLines) all() []status {
	s.mu.Lock()
	defer s.mu.Unlock()

	return append([]status(nil), s.lines...)
}

func expectStatus(t *testing.T, running *sidecar, match func(status) bool) {
	t.Helper()

	waitFor(t, func() error {
		lines := running.statuses.all()
		for _, line := range lines {
			if match(line) {
				return nil
			}
		}
		return errors.New("no status matched yet")
	})
}

func waitFor(t *testing.T, try func() error) {
	t.Helper()

	if err := tstest.WaitFor(30*time.Second, try); err != nil {
		t.Fatal(err)
	}
}
