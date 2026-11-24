# Tailnet

`nyte-tailnet` is a Go sidecar. The host spawns it to join a tailnet through `tsnet`. Go is here because `tsnet` exists only in Go, not for speed. The README explains the flags, the status protocol and how the host supervises it.

## Before you finish

Run both, and fix what they report before anything else:

```sh
pnpm --filter @nyte-ai/tailnet typecheck   # golangci-lint run, go mod tidy -diff
pnpm --filter @nyte-ai/tailnet test        # go test -race against a local Tailscale test control
```

- Format with `pnpm --filter @nyte-ai/tailnet format`, which runs `gofumpt`. Never hand-format Go.
- golangci-lint is pinned in the `golangci` script. Fix a finding. Don't disable its linter.
- A `//nolint` names one linter and says why, as in `//nolint:gosec // The host chooses --dir.` `nolintlint` rejects any other kind.
- If `go` isn't on `PATH`, put the folder of `mise which go` on it.
- `pnpm --filter @nyte-ai/tailnet vulncheck` runs `govulncheck`. CI runs it daily.

## Trust boundary

The sidecar decides who reaches the host. Every rule here fails closed.

- `gate` admits a request only after `WhoIs` names the caller's node and user.
- A `WhoIs` error, a missing node or profile, or an owner not yet observed means `403`. It never means a proxied request.
- The proxy deletes `principalHeader` from every outgoing request before it sets its own. The host trusts that header only on the socket it gave the sidecar.
- `principal`, `hello` and `status` are wire contracts with the host's `openTailnet` (`principalCheck`, `helloCheck`, `TailnetStatusType`). Change both sides in one commit.
- A change the old host can't read bumps `protocol` here and `PROTOCOL` in the host together.
- The auth key arrives only on `--auth-key-fd`. Never log it. Never accept it in a flag or an environment variable.
- `credentialVariables` stay cleared at start.
- Stdout carries only protocol lines. Logs go to stderr through `log`. `forbidigo` rejects `fmt.Print` and `os.Stdout`.
- SIGTERM or a closed lease ends with a `stopped` line and exit code 0, at any point, startup included.
- Stdin is the host's lease. Read it for nothing else.
- `lockState` keeps one node per state directory. Every command that starts a `tsnet.Server` takes it first.
- The HTTP server keeps `ReadHeaderTimeout` and `IdleTimeout`.
- Leave `ReadTimeout` and `WriteTimeout` at zero. Proxied WebSockets live for hours.

## Changes

- Don't add or upgrade dependencies unless asked.
- One exception: a vulnerability that `vulncheck` marks as reachable. Bump only that module, then run `go mod tidy`.
- Release builds are pure Go with `CGO_ENABLED=0`. Don't add cgo.

## Tests

- Tests run real `tsnet` nodes against `testcontrol`, not mocks.
- They swap `listenTLS` for `listenPlain`, because test control issues no certificates. A change to `listenTLS` needs a run on a real tailnet.
- Test timing in memory with the `synctest` package. `time.Sleep` inside its bubble moves its fake clock, so backoff and timeouts take no real time.
- Wait on real nodes and processes with `tstest.WaitFor`, never a fixed sleep.
- A test that waits for a process to end checks how it ended.
- Every test helper calls `t.Helper()`.
