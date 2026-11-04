# @nyte-ai/host

The Node and edge sides of a Nyte host. It serves the host that `composeHost` in `@nyte-ai/core` builds, and it supplies the stores, workspaces and plugin loading a machine or a deployment needs.

## Quick start

`openHost` composes a host for this machine and `listen` serves it over HTTP:

```ts
import process from "node:process";
import { openHost } from "@nyte-ai/host";

const host = await openHost({});
const listener = await host.listen({
  transport: { kind: "http", port: 4000 },
  auth: { kind: "token", token: process.env.NYTE_TOKEN ?? "" },
});

console.log(listener.address);
```

By default `openHost` keeps sessions in SQLite under `~/.nyte` and opens the current directory as a local workspace. A listener token needs at least 16 characters. In Node, `sdk.open` from `@nyte-ai/sdk` is this same `openHost`.

| Variable | Default | What it does |
| --- | --- | --- |
| `NYTE_DB` | `~/.nyte/nyte.db` | Path of the default SQLite store |

## Serving

`listen` serves a host over `node:http`, a unix socket or a bare fetch handler. `listenFetch` from `@nyte-ai/host/listen-fetch` is the fetch handler alone, with no `node:*` import, for Workers. Both serve the [`@nyte-ai/protocol`](../protocol/README.md) operations, CORS, and the `/.nyte/identity` and `/.nyte/describe` routes. A request authenticates with the listener token, a pairing code, a paired device's token, or your own `authorize` function.

Over `node:http` and the unix socket, `listen` also serves the WebSocket at `/.nyte/ws` that the [host protocol](../../docs/host-protocol/README.md) describes. Only the unix socket answers the operations marked `local`.

## Stores

Each store implements core's `Store` and publishes each change as one transaction with its compare-and-set and log append.

| Store | Entry | Backing |
| --- | --- | --- |
| `sqliteStore` | `@nyte-ai/host` | `node:sqlite` |
| `postgresStore` | `@nyte-ai/host` | A connection string or any `pg`-shaped pool |
| `durableObjectStore` | `@nyte-ai/host/durable-object` | A Durable Object's SQLite storage |

## Workspaces

- `localProvider` serves a folder on this machine. It reads files over `node:fs` and versions them by content. It scans with `.gitignore` rules, searches with ripgrep or a scan when ripgrep is missing, and watches for changes. It runs processes over pipes or a pty through `@lydell/node-pty`, which doesn't run under Bun. It drives git through its CLI.
- `chatOnlyProvider` serves a workspace with no files and no processes.
- `sandboxProvider` serves a workspace in a remote sandbox through a `boot` function you supply.

`chatOnlyProvider` and `sandboxProvider` come from `@nyte-ai/host/providers`, which has no `node:*` import.

## Plugins

`createPluginLoader` imports the core plugins in `.nyte/plugins` directories. It loads a plugin again when a file in its import graph changes, and keeps the same plugin while none does.

## Deployments

[`packages/examples`](../examples/README.md) holds two deployments built on this package. One is a Cloudflare Worker whose Durable Object runs one host from its alarm. The other is a Nitro app for Vercel whose heads run as workflows.

## Development

```sh
pnpm --dir packages/host test
pnpm --dir packages/host typecheck
```

The tests run every store against one conformance suite: SQLite, PostgreSQL over PGlite, and the Durable Object store over a `node:sqlite` stand-in for its SQL storage. The Worker's own tests live with the [Cloudflare example](../examples/cloudflare/README.md).

After you change `@nyte-ai/schema` wire types or core's stored record types, run `pnpm --dir packages/host check:store` and backfill what it reports.
