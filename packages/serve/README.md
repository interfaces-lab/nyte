# @nyte-ai/serve

Serves a composed Nyte SDK through `@nyte-ai/server` on one address, and
optionally the built web app from the same origin, so the browser needs no CORS.
The desktop app embeds it for Remote access.

```ts
const serving = await startServe({ sdk, attach, version, host, port, token, appRoot });
```

`sdk` is already composed; `attach(sessionId)` makes this process the session's
runner before a remote send, job, reply, or watch. `host` defaults to
`127.0.0.1` and `port` to an ephemeral one. Without `appRoot`, `pairingUrl`
opens the hosted app at `https://app.nyte.sh`. `close()` ends the listener and
its watches; work a session already accepted continues. `findTailnetAddress`
returns this machine's Tailscale IPv4 address.

## CLI

```sh
pnpm serve -- --trust
```

Serves one folder, the current directory or `--cwd`. Open the printed link to pair a browser.

| Flag | Meaning |
| --- | --- |
| `--cwd <path>` | Folder to serve |
| `--host <address>` | Address to bind, `127.0.0.1` by default; `tailnet` binds this machine's tailnet IPv4 |
| `--port <number>` | Port to bind, `5180` by default |
| `--token <token>` | Bearer token instead of the one saved in `~/.nyte/serve/token` |
| `--trust` | Trust the folder before serving it. Trust is saved in `~/.nyte/workspaces.json` |
| `--no-app` | Serve the API without the web app |
| `--open` | Open the pairing link in the default browser |
