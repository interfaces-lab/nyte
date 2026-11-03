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

For every connection the sidecar asks `LocalClient.WhoIs` who is calling and builds the principal `{ kind: "tailscale", userId, loginName, node, tags, owner }` (`node` is the caller's stable node ID; `owner` is true when the caller is the untagged Tailscale user who owns this untagged node). A caller the access mode refuses gets `403` with `{ "code": "denied", "message": "..." }`, the host's own error shape. An admitted request, WebSocket upgrades included, is proxied to `--socket` with the principal, as base64url JSON, in `X-Nyte-Tailnet-Principal`; a value the caller sent there is replaced. The host trusts that header only on the socket it gave the sidecar.

Status goes to stdout, one JSON line per change:

```json
{ "state": "running", "dnsName": "nyte.example.ts.net", "https": "available", "access": "owner", "tags": [] }
```

`state` is `starting`, `needs_login` (with `authUrl`), `needs_machine_approval`, `running` or `stopped`; `disabled` is the host's, for when it runs no sidecar. `https` is `pending` until the node runs and has tried for its certificate, then `available` or `unavailable`. `tags` are the node's own once it runs. Logs go to stderr. `SIGTERM` closes the listener and the node, writes a last `stopped` line and exits 0.

## Sidecar or linked library

[libtailscale](https://github.com/tailscale/libtailscale) wraps the same `tsnet` as a C library, so the host could link Tailscale instead of running a second process. Measured on an Apple M4 Pro, macOS 27.2, Go 1.27.3, Node 26.13.0: libtailscale at `ac7ed43` (tailscale.com v1.104.1), `nyte-tailnet` on v1.104.5, every artifact built with `-trimpath -ldflags="-s -w"`. Each run starts the process, enrolls a fresh node against one local test control server (`testcontrol` with its own DERP and STUN, HTTPS off so nothing reaches Let's Encrypt, `TS_NO_LOGS_NO_SUPPORT=true` so nothing reaches log.tailscale.com), times the moment it reports running, and reads `ps -o rss=` one second later.

| Variant | Artifact size | Resident after up (3 runs) | Time to running (3 runs) |
| --- | --- | --- | --- |
| `nyte-tailnet` sidecar | 19.3 MiB binary | 34.2, 34.3, 33.5 MiB | 359, 332, 326 ms |
| `libtailscale.a` linked into a C harness | 25.6 MiB archive, 19.3 MiB harness | 31.2, 31.1, 31.5 MiB | 380, 352, 352 ms |
| `libtailscale.dylib` loaded by a C harness | 19.3 MiB dylib | 31.3, 31.4, 31.7 MiB | 352, 352, 354 ms |
| `libtailscale.dylib` through `node:ffi` | 19.3 MiB dylib | 78.2, 78.6, 78.2 MiB (idle Node: 47.1) | 386, 380, 384 ms |

Times include starting the process; the `node:ffi` row includes Node's own start.

The harness is the smallest C program that brings a node up:

```c
#include <stdio.h>
#include <unistd.h>
#include "tailscale.h"

int main(int argc, char **argv) {
	tailscale ts = tailscale_new();
	tailscale_set_dir(ts, argv[2]);
	tailscale_set_hostname(ts, "bench");
	tailscale_set_control_url(ts, argv[1]);
	tailscale_set_logfd(ts, -1);
	if (tailscale_up(ts) != 0) return 1;
	printf("running\n");
	fflush(stdout);
	for (;;) pause();
}
```

With the harness saved as `harness.c` next to the library:

```sh
git clone https://github.com/tailscale/libtailscale packages/tailnet/.cache/libtailscale
cd packages/tailnet/.cache/libtailscale
export CGO_ENABLED=1 MACOSX_DEPLOYMENT_TARGET=15.0
go build -trimpath -ldflags="-s -w" -buildmode=c-archive -o libtailscale.a
go build -trimpath -ldflags="-s -w" -buildmode=c-shared -o libtailscale.dylib
cc -I. harness.c libtailscale.a -framework CoreFoundation -framework Security -framework IOKit -framework SystemConfiguration -lresolv -o harness
```

What Node would need to call it:

- **`node:ffi`** exists since Node 26.1, at stability 1 (experimental), on by default, behind `--allow-ffi` under the permission model. It loaded the dylib and brought the node up. Every call is synchronous on the calling thread: `tailscale_up` held the event loop for the whole enrollment, and would hold it indefinitely while a node waits for a login, as `tailscale_accept` would for each connection, so all of it has to live on a worker thread.
- **An N-API addon** linking `libtailscale.a`, with `napi_create_async_work` around the blocking calls: a C toolchain and cgo cross-builds for every platform and architecture the desktop and `nyte host` ship, plus prebuilt binaries. N-API keeps one build working across Node and Electron.
- **Either way** the Go runtime lives inside the host. With the dylib loaded through `node:ffi`, `SIGTERM` no longer ended the Node process; it took `SIGKILL`. A Go panic takes the host down with it, and the runtime can't be unloaded.
- libtailscale exposes plain `tailscale_listen`, `tailscale_getremoteaddr` and status JSON. It has no `WhoIs`, no status stream and no `ListenTLS`; Node would reach all three through the LocalAPI that `tailscale_loopback` serves on 127.0.0.1, reimplementing what the sidecar does in Go.

Conclusion: keep the sidecar. Linking would save about 3 MiB and no start time, since the sidecar reached running as fast as the library did, and the artifact is the same 19 MiB either way. In exchange the host would take on an experimental FFI or a native addon built for every platform, a worker thread around every blocking call, a Go runtime that swallows its `SIGTERM`, and a Tailscale crash that ends the host. The sidecar costs one supervised process, turns a crash into a restart, and reaches the host over the socket that already carries the protocol.
