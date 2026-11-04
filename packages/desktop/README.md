# @nyte-ai/desktop

The Electron desktop app for Nyte. It runs the Nyte host as a background login agent and opens windows onto it. The interface itself is [`@nyte-ai/app`](../app/README.md).

## Run it

From the repository root:

```sh
pnpm dev:desktop
```

## How it works

Main-process code is in `src/main`, the preload bridge in `src/preload`, and the renderer entry in `src/renderer`. `src/shared` holds code more than one of them imports. `src/workers` holds the host's entry, `nyte-host.ts`, and the worker entries. Session behavior shared with other clients belongs in core.

The desktop's host is `serveHost` from `@nyte-ai/service`, the same host `nyte host` serves. It keeps running after the app quits:

- The app's own executable runs `out/main/nyte-host.js` with `ELECTRON_RUN_AS_NODE=1`. This lets terminals open through the `@lydell/node-pty` the app ships. The Bun-compiled `nyte host` can't load it and answers a terminal start with `unavailable`.
- The host starts in your home folder, its default workspace, and runs the bundled `nyte-tailnet` sidecar.
- On macOS the host is a launchd login agent. The packaged app registers `Contents/Library/LaunchAgents/ai.nyte.desktop.host.plist` through SMAppService.
- A macOS development build writes and bootstraps `~/Library/LaunchAgents/ai.nyte.desktop.dev.host.plist`. It points at the development Electron and entry, with `packages/tui/dist/nyte-tailnet` as the sidecar.
- On Linux the app starts the host as a detached process. On Windows the app doesn't start a host.
- The host serves `$NYTE_HOME/host.sock`, where `NYTE_HOME` defaults to `~/.nyte`. Main connects there.

To find the running host:

```sh
pgrep -f nyte-host.js
```

A window reaches the host over a MessagePort that main bridges to the socket. The window never learns the socket path or a token. Each SDK request crosses the port with its own flow control, so uploads stream. When the host restarts, open requests fail like a dropped connection and the SDK reconnects.

Main is also a client on the host's event channel. It offers the agents' browser and canvas previews to the host as client actions. With **Pause agents while asleep** on in Settings › General, main pauses the host's runs while the Mac sleeps.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `NYTE_HOME` | `~/.nyte` | Folder for the host socket, store and credentials |
| `NYTE_DESKTOP_HOST_LABEL` | `ai.nyte.desktop.dev.host` | launchd label for a development build's host. Packaged builds ignore it |
| `MAIN_VITE_NYTE_CONNECT_ORIGIN` | unset | Build-time Nyte Connect broker origin, a canonical HTTPS origin |
| `MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY` | unset | Build-time Clerk publishable key |
| `MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST` | unset | Build-time Clerk Frontend API host, a bare host name |

Set all three `MAIN_VITE_*` variables to enable account remote access. The publishable key must name the same Frontend API host. Main checks them at start. A build that is missing one of them, or has an invalid one, has no account sign-in.

## Providers and usage

Settings › Providers connects and disconnects model providers. Sign-ins and the model catalog live in `~/.nyte`, so a sign-in made in the desktop or the TUI counts in both.

Settings › Usage shows what Nyte and other tools recorded. The host reads that history locally, with no credentials or network request. It reads Claude Code history from `CLAUDE_CONFIG_DIR`, which defaults to `~/.claude`, and Codex history from `CODEX_HOME`, which defaults to `~/.codex`. Dollar figures estimate the recorded tokens at API rates. They aren't subscription charges. Plan limits are the one network request. The page asks Anthropic and OpenAI for the usage windows of the accounts Nyte shares with Claude Code and Codex.

## Connect to a deployed host

Deploy the [Vercel example](../examples/vercel/README.md) with `NYTE_TOKEN` and a model credential. Then test it from this checkout:

1. Run `pnpm dev:desktop` from the repository root.
2. Open Settings › Server, click **Connect to Host…**, enter the deployment's address and its `NYTE_TOKEN`, and click **Connect**. The desktop saves the connection in `~/.nyte/server.json`.
3. Start a new chat in the **Cloud** environment, send a short message, and confirm that an answer appears.
4. Open another chat, return to the Cloud chat, and confirm its answer is still there.

Cloud chats use the server's provider credentials and models. Local provider settings affect only local chats. Signing in to a provider on the desktop doesn't configure that provider on the server.

## Remote access

Settings › Server lets phones and browsers reach this Mac. The [remote access guide](../docs/content/docs/remote-access.mdx) has the user steps. There are three ways in.

### Tailscale

The host runs its own tailnet node through the bundled `nyte-tailnet`. The Server page reads and changes it with `host.tailnet.status`, `host.tailnet.configure` and `host.tailnet.logout` over the local socket. The page shows the sign-in link, the admin approval the node waits for, its `https://<name>.ts.net` address once it runs, or why it stopped.

### Cloudflare Tunnel

The Cloudflare Tunnel plugin is off until you set it up and start it. You need:

- A Cloudflare account with a domain on it.
- A remotely managed named tunnel whose one public hostname routes to `http://127.0.0.1:<port>`.
- `cloudflared` installed in `/opt/homebrew/bin`, `/usr/local/bin` or `/usr/bin`. The plugin doesn't run on Windows.

Settings takes the hostname, the port and the tunnel token, and stores them in `~/.nyte/cloudflare-tunnel.json`. Starting binds `127.0.0.1:<port>` and runs `cloudflared` under a small `sh` supervisor with a fixed environment, a private `HOME`, its own `--config` and the token in `TUNNEL_TOKEN`. The supervisor ends `cloudflared` when Nyte stops or dies.

The row shows the tunnel as connected only after the routes from the Cloudflare dashboard arrive and send that hostname, and nothing else, to the listener. Any other route stops the connector. So do routes that haven't arrived 20 seconds after the tunnel connects. After a restart the tunnel stays off until you start it again. Paired devices keep working without pairing again.

Pair each device with **Pair…**. The desktop shows each device's token once, as a QR code and a link, and stores only its SHA-256 digest. An unused code expires after ten minutes. Anyone who holds a code can connect as that device until you remove it. **Remove** refuses that device's token at once and drops every open connection, so the other devices reconnect.

This is a personal setup with no Nyte account or relay. Know what it exposes:

- Cloudflare terminates TLS, so Cloudflare can read every request, device tokens included.
- Anyone who can open the tunnel's live logs in that Cloudflare account can read the same traffic, whatever the local log level.
- Private network routes attached to the tunnel never reach `cloudflared`'s configuration, so Nyte can't see or refuse them. Use a tunnel with none.

The plugin contract is `src/host/connections/remote-access-plugin.ts`. Plugins are built in and registered statically. Nyte doesn't discover or install plugins at run time.

### Nyte account

A build with the `MAIN_VITE_*` variables set can link this Mac to your Nyte account through [`@nyte-ai/connect`](../connect/README.md). That README covers linking, the relay, leases, device enrollment and what the relay can read. The host listens on nothing beyond loopback. This Mac opens one WebSocket to the broker's relay.

The desktop keeps your sign-in sealed in `account.json` in the app's user data folder. The machine key lives in `~/.nyte/connect.json`. If that file can't be read, remote access stays off and Settings says so. Signing out of the account leaves remote access running, because everything after linking signs with the machine key. **Unlink** refuses every device and forgets the link.

## Development

```sh
pnpm --dir packages/desktop test
pnpm --dir packages/desktop typecheck
pnpm --dir packages/desktop build
pnpm --dir packages/desktop package
```

`package` builds installers for the current platform without publishing them. [UPDATES.md](UPDATES.md#build-and-publish) lists the platform-specific packaging scripts. The end-to-end suite is in [e2e/README.md](e2e/README.md).

Read [AGENTS.md](AGENTS.md) before changing the desktop. [UPDATES.md](UPDATES.md) covers updates and [build/ICONS.md](build/ICONS.md) covers icons.
