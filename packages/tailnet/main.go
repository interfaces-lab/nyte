package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

type options struct {
	dir        string
	hostname   string
	socket     string
	access     string
	tags       []string
	controlURL string
	authKeyFD  int
	logout     bool
}

const protocol = 1

var version = "dev"

type hello struct {
	Type     string `json:"type"`
	Protocol int    `json:"protocol"`
	Version  string `json:"version"`
}

var credentialVariables = []string{
	"TS_AUTHKEY",
	"TS_AUTH_KEY",
	"TS_CLIENT_SECRET",
	"TS_CLIENT_ID",
	"TS_ID_TOKEN",
	"TS_AUDIENCE",
}

func main() {
	opts, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "nyte-tailnet:", err)
		os.Exit(2)
	}

	for _, name := range credentialVariables {
		os.Unsetenv(name)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	if opts.logout {
		err = logout(ctx, opts)
	} else {
		err = serveNode(ctx, opts, os.Stdin, os.Stdout)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, "nyte-tailnet:", err)
		os.Exit(1)
	}
}

func serveNode(ctx context.Context, opts options, lease io.Reader, out io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	go func() {
		io.Copy(io.Discard, lease)
		cancel()
		time.AfterFunc(time.Second, func() { os.Exit(0) })
	}()

	if err := writeLine(out, hello{Type: "hello", Protocol: protocol, Version: version}); err != nil {
		return err
	}

	lock, err := lockState(opts.dir)
	var locked *lockedError
	if errors.As(err, &locked) {
		tags := opts.tags
		if tags == nil {
			tags = []string{}
		}
		writeLine(out, status{State: "stopped", Reason: "locked", Holder: locked.holder, HTTPS: "unavailable", Access: opts.access, Tags: tags})
	}
	if err != nil {
		return err
	}
	defer lock.Close()

	authKey, err := readAuthKey(opts.authKeyFD)
	if err != nil {
		return err
	}

	return run(ctx, opts, authKey, out, listenTLS)
}

func parseOptions(args []string) (options, error) {
	opts := options{authKeyFD: -1}
	set := flag.NewFlagSet("nyte-tailnet", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.StringVar(&opts.dir, "dir", "", "")
	set.StringVar(&opts.hostname, "hostname", "nyte", "")
	set.StringVar(&opts.socket, "socket", "", "")
	set.StringVar(&opts.access, "access", "owner", "")
	set.StringVar(&opts.controlURL, "control-url", "", "")
	set.IntVar(&opts.authKeyFD, "auth-key-fd", -1, "")
	set.BoolVar(&opts.logout, "logout", false, "")
	set.Func("tag", "", func(value string) error {
		if !strings.HasPrefix(value, "tag:") {
			return fmt.Errorf("%s isn't a tag; tags look like tag:name", value)
		}
		opts.tags = append(opts.tags, value)
		return nil
	})

	if err := set.Parse(args); err != nil {
		return opts, err
	}

	if opts.dir == "" {
		return opts, errors.New("--dir is required")
	}

	if opts.logout {
		return opts, nil
	}

	if opts.socket == "" {
		return opts, errors.New("--socket is required")
	}

	if opts.access != "owner" && opts.access != "tailnet" {
		return opts, fmt.Errorf("--access is owner or tailnet, not %s", opts.access)
	}

	if opts.access == "owner" && len(opts.tags) > 0 {
		return opts, errors.New("a tagged node has no owner, so --tag needs --access tailnet")
	}

	return opts, nil
}

func readAuthKey(fd int) (string, error) {
	if fd < 0 {
		return "", nil
	}

	file := os.NewFile(uintptr(fd), "auth-key")
	if file == nil {
		return "", fmt.Errorf("file descriptor %d is not open", fd)
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 4096))
	if err != nil {
		return "", fmt.Errorf("reading the auth key: %w", err)
	}

	return strings.TrimSpace(string(data)), nil
}

func newNode(opts options, authKey string) *tsnet.Server {
	return &tsnet.Server{
		Dir:           opts.dir,
		Hostname:      opts.hostname,
		AdvertiseTags: opts.tags,
		AuthKey:       authKey,
		ControlURL:    opts.controlURL,
		UserLogf:      log.Printf,
	}
}

func logout(ctx context.Context, opts options) error {
	lock, err := lockState(opts.dir)
	if err != nil {
		return err
	}
	defer lock.Close()

	node := newNode(opts, "")
	defer node.Close()

	if err := node.Start(); err != nil {
		return err
	}

	client, err := node.LocalClient()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	return client.Logout(ctx)
}
