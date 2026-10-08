# @nyte-ai/serve

Serves a composed Nyte SDK through `@nyte-ai/server` on one address, and
optionally the built web app from the same origin, so the browser needs no CORS.
The desktop app embeds it for Remote access.

```ts
const serving = await startServe({ sdk, attach, version, auth, hostname, port, appRoot });
```

`sdk` is already composed; `attach(sessionId)` makes this process the session's
runner before a remote send, job, reply, or watch. `hostname` defaults to
`127.0.0.1` and `port` to an ephemeral one. Without `appRoot`, `pairingOrigin`
points `pairingUrl` at the hosted app at `https://app.nyte.sh`. `close()` ends
the listener and its watches; work a session already accepted continues.
`findTailnetAddress` returns this machine's Tailscale IPv4 address.

`@nyte-ai/serve/headless` serves a host runtime instead: one profile's
registered folders, its signed identity, and `workspaces: registry`.
`startHeadless` binds it. `accountShare` is the Connect share behind
`nyte serve --account`. It admits account devices as controllers, and as owners
only when a device enrolled as one and the operator passed `deviceAdmin`.

## Commands

| Command | What runs |
| --- | --- |
| `nyte serve` | The installed CLI as a headless host. API only, no web app. `--account` also serves it through a Nyte account. |
| `pnpm serve` | Repository development. Builds `packages/app`, then runs this package's `nyte-serve`, which serves the API and the built web app from one address. No account. |

Both use the host profiles under `~/.nyte/hosts`. A profile runs one host at a
time. User steps for phones and browsers are in the
[remote access guide](../docs/content/docs/remote-access.mdx).

### `nyte serve`

```sh
nyte account login
nyte serve --workspace ~/code/app --trust --account
```

The host runs while the command runs; Ctrl-C stops it. It prints the API
address, each folder with its trust, and the path of the bearer token for direct
access. Runs need a model provider configured on the host, for example with
`nyte login` there or from an admin device.

| Flag | Meaning |
| --- | --- |
| `--workspace <path>` | Register a folder on the host. Repeatable. The current directory by default |
| `--trust` | Trust each `--workspace` folder as it is now |
| `--profile <name>` | Host identity and history under `~/.nyte/hosts`, `default` by default |
| `--host <address>` | Address to bind, `127.0.0.1` by default |
| `--port <number>` | Port to bind, a free one by default |
| `--account` | Also serve the profile's Nyte account link through the Connect relay |
| `--device-admin` | With `--account`, devices that enrolled as admins can add folders and manage providers. Without it every device only runs sessions |

`nyte account` links a profile to a Nyte account. It is separate from
`nyte login`, which signs in a model provider.

| Command | Result |
| --- | --- |
| `nyte account login` | Prints a page, a host linking code, and a key fingerprint. Approve the host from a browser on any device. `--name` sets how the account lists it; `--timeout <seconds>` stops waiting sooner than the request's five-minute expiry |
| `nyte account status` | The saved link, whether account sharing is on, and enrolled devices. It doesn't check reachability |
| `nyte account unlink` | Removes the host from the account and refuses its devices |

Each takes `--profile <name>`. `login` and `unlink` need the profile to
themselves, so stop `nyte serve` on it first. Linking needs the Connect origin
the CLI was built with, or `NYTE_CONNECT_ORIGIN` at run time.

### `pnpm serve`

```sh
pnpm serve -- --trust
```

Open the printed link to connect a browser.

| Flag | Meaning |
| --- | --- |
| `--workspace <path>` | Register a folder on the host. Repeatable. The current directory by default |
| `--trust` | Trust each `--workspace` folder as it is now |
| `--profile <name>` | Host profile under `~/.nyte/hosts`, `default` by default |
| `--host <address>` | Address to bind, `127.0.0.1` by default; `tailnet` binds this machine's tailnet IPv4 |
| `--port <number>` | Port to bind, `5180` by default |
| `--no-app` | Serve the API without the web app |
| `--open` | Open the pairing link in the default browser |
