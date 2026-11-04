# @nyte-ai/tailnet

`nyte-tailnet` is a sidecar that puts a Nyte host on a tailnet as a device of its own. It embeds Tailscale through [`tsnet`](https://pkg.go.dev/tailscale.com/tsnet), so the machine doesn't need Tailscale installed. The sidecar never touches a Tailscale app or CLI that is installed.

## Build

```sh
pnpm --dir packages/tailnet build
```

The build writes `dist/nyte-tailnet` for this machine. `build.mjs` stamps the version into the binary from `NYTE_RELEASE_VERSION`, or from `@nyte-ai/host`'s version when that is unset. `nyte-tailnet --version` prints it.

On macOS and Linux, the TUI build puts `nyte-tailnet` beside `nyte` in `packages/tui/dist`. It ships next to `nyte` in every release tarball, in the installers, and in the desktop app's resources, signed with the app. The host runs the `nyte-tailnet` in its own executable's directory and refuses one whose hello names another version.

## Command line

The host starts the sidecar. Don't run it yourself.

```sh
nyte-tailnet --dir <state> --socket <socket> --hostname nyte --access owner [--tag tag:name]... [--auth-key-fd 3] [--control-url URL]
nyte-tailnet --dir <state> --logout
nyte-tailnet --version
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--dir` | required | The node's state directory, `tsnet.Server.Dir`. The node keeps its login there. The host passes `~/.nyte/tailnet`. |
| `--socket` | required, except with `--logout` | The unix socket the host opens for this sidecar, `~/.nyte/tailnet.sock`. Every admitted request goes there. |
| `--hostname` | `nyte` | The device name. The node answers at `https://<hostname>.<tailnet>.ts.net`. |
| `--access` | `owner` | `owner` admits only the Tailscale user who owns this node. `tailnet` admits anyone the tailnet's access rules let through. |
| `--tag` | none | A tag to advertise at first enrollment, such as `tag:name`. Repeat it for more tags. A tagged node has no owner, so a tag needs `--access tailnet`. The auth key must be allowed to grant it. |
| `--auth-key-fd` | none | A file descriptor to read a one-time auth key from until it closes, up to 4 KiB. The host writes the key to fd 3 and closes the pipe. |
| `--control-url` | Tailscale's | A different control server, such as Headscale. |
| `--logout` | off | Signs the node out and exits. |

No flag takes the auth key itself. The sidecar clears `TS_AUTHKEY` and the other credential variables at start, so the key never shows in the process list or the environment.

## How it works

Stdin is the host's lease. The host keeps the pipe open for the sidecar's life and never writes to it. When the sidecar reads end of file, because the host closed it or died, even by `SIGKILL`, it shuts the node down and exits within a second.

One node runs per state directory. Before it starts `tsnet`, the sidecar takes an exclusive `flock` on `<dir>/nyte-tailnet.lock` and writes its pid and a random instance id there. `--logout` takes the lock too. A second sidecar on the same directory prints `{ "state": "stopped", "reason": "locked", "holder": <pid>, ... }` and exits 1. The kernel drops the lock when the holder exits.

Once it is running, the node fetches its certificate and serves HTTPS on port 443. The tailnet needs MagicDNS and HTTPS certificates turned on.

For every connection, the sidecar asks `LocalClient.WhoIs` who is calling and builds this principal:

```json
{ "kind": "tailscale", "userId": "...", "loginName": "...", "node": "...", "tags": [], "owner": true }
```

`node` is the caller's stable node ID. `owner` is true when the caller is the untagged Tailscale user who owns this untagged node.

- A caller the access mode refuses gets `403` with `{ "code": "denied", "message": "..." }`, the host's own error shape.
- The sidecar proxies an admitted request to `--socket`, WebSocket upgrades included. It puts the principal, as base64url JSON, in `X-Nyte-Tailnet-Principal` and replaces any value the caller sent there.
- The host trusts that header only on the socket it gave the sidecar.

## Status protocol

The first stdout line is the handshake:

```json
{ "type": "hello", "protocol": 1, "version": "0.0.24" }
```

The host refuses another `protocol`, with reason `protocol`, and a `version` other than its own, with reason `version`. Every later line is a status, one JSON line per change:

```json
{ "state": "running", "dnsName": "nyte.example.ts.net", "https": "available", "access": "owner", "tags": [] }
```

| Field | Values |
| --- | --- |
| `state` | `starting`, `needs_login` with `authUrl`, `needs_machine_approval`, `running` or `stopped`. The host reports `disabled` itself when it runs no sidecar. |
| `https` | `pending` until the node runs and has tried for its certificate, then `available` or `unavailable`. |
| `tags` | The node's own tags once it runs. |
| `reason` | Why a `stopped` status stopped. See below. |

The sidecar sets `reason` to `locked`, with `holder`. The host sets the other reasons, each with a `detail` sentence:

| Reason | When |
| --- | --- |
| `protocol` | The hello names another protocol. |
| `version` | The hello names another version. |
| `hello_timeout` | No hello arrived within 10 s. |
| `start_timeout` | No `running`, `needs_login` or `needs_machine_approval` arrived within 120 s. |
| `invalid_status` | The host couldn't read a line. It logs the line and restarts the sidecar. |
| `exited` | The sidecar exited without being asked. |

The sidecar logs to stderr. The host appends every stderr line to `~/.nyte/tailnet/sidecar.log`. After an exit it didn't ask for, the host attaches the last 4 KiB of stderr to the `stopped` status as `stderr`.

On `SIGTERM` the sidecar closes the listener and the node, writes a last `stopped` line and exits 0.

## Development

Building and testing need Go. `mise.toml` pins its version.

```sh
pnpm --dir packages/tailnet test
```

The tests run the sidecar against a local Tailscale test control server.
