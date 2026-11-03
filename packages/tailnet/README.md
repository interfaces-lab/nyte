# @nyte-ai/tailnet

`nyte-tailnet` puts a Nyte host on a tailnet as a device of its own, with Tailscale built in through [`tsnet`](https://pkg.go.dev/tailscale.com/tsnet). The machine doesn't need Tailscale installed, and the sidecar never touches a Tailscale app or CLI that is.

```sh
pnpm --dir packages/tailnet build   # dist/nyte-tailnet, for this machine
pnpm --dir packages/tailnet test    # the test control integration test
```

## Contract

The host starts it; nobody else should.

```sh
nyte-tailnet --dir <state> --socket <host.sock> --hostname nyte --access owner [--tag tag:name]... [--auth-key-fd 0] [--control-url URL]
nyte-tailnet --dir <state> --logout
```

| Flag | Meaning |
| --- | --- |
| `--dir` | The node's state directory, `tsnet.Server.Dir`. The node keeps its login there. |
| `--socket` | The host's unix socket. Every admitted request goes there. |
| `--hostname` | The device name: the node answers at `https://<hostname>.<tailnet>.ts.net`. |
| `--access` | `owner` admits only the Tailscale user who owns this node. `tailnet` admits anyone the tailnet's access rules let through. |
| `--tag` | Advertised at first enrollment. A tagged node has no owner, so a tag needs `--access tailnet`. The auth key must be allowed to grant it. |
| `--auth-key-fd` | Reads a one-time auth key from this file descriptor (`0` for stdin) until it closes. There is no flag for the key itself, and `TS_AUTHKEY` and the other credential variables are cleared at start, so the key never shows in the process list or the environment. |
| `--control-url` | A control server other than Tailscale's, such as Headscale. |
| `--logout` | Signs the node out and exits. |

The node serves HTTPS with `ListenTLS("tcp", ":443")` once it is running, after fetching its certificate; the tailnet needs MagicDNS and HTTPS certificates on.

For every connection the sidecar asks `LocalClient.WhoIs` who is calling and builds the principal `{ kind: "tailscale", userId, loginName, node, tags }` (`node` is the caller's stable node ID). A caller the access mode refuses gets `403` with `{ "code": "denied", "message": "..." }`, the host's own error shape. An admitted request, WebSocket upgrades included, is proxied to `--socket` with the principal, as base64url JSON, in `X-Nyte-Tailnet-Principal`; a value the caller sent there is replaced. The host trusts that header only on the socket it gave the sidecar.

Status goes to stdout, one JSON line per change:

```json
{ "state": "running", "dnsName": "nyte.example.ts.net", "https": "available", "access": "owner", "tags": [] }
```

`state` is `starting`, `needs_login` (with `authUrl`), `needs_machine_approval`, `running` or `stopped`; `disabled` is the host's, for when it runs no sidecar. `https` is `pending` until the node runs and has tried for its certificate, then `available` or `unavailable`. `tags` are the node's own once it runs. Logs go to stderr. `SIGTERM` closes the listener and the node, writes a last `stopped` line and exits 0.
