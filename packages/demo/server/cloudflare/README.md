# Nyte on a local Durable Object

This demo runs Nyte's SDK inside a SQLite-backed Durable Object and serves the
existing desktop HTTP/SSE protocol on `http://127.0.0.1:8787`.

```text
desktop → Wrangler → NyteHost → SqlStore → DO SQLite
                        │
                        └─ alarm → sdk.advance()
                                     │
                                     └─ local Node HTTP transport → Codex
```

## Run

Sign in to OpenAI Codex in the Nyte desktop, then run from the repository root:

```sh
pnpm --dir packages/demo/server/cloudflare run sync:codex
pnpm --dir packages/demo/server/cloudflare run dev
```

`sync:codex` refreshes through Nyte's local credential store and copies the
access token into the ignored `.dev.vars` file. The refresh token stays in
`~/.nyte`. It also writes the selected public model definition to the ignored
`model.json`. The default is `gpt-6.1-sol`; pass `--model <id>` to select another
Codex model in Nyte's catalog. Repeat the sync when the access token expires.

The dev command starts Wrangler on port 8787 and the local Codex HTTP transport
on port 8788. Both bind to `127.0.0.1`. Ctrl+C stops both processes.

## Connect the desktop

Open **Settings → Environments → Cloud → Connect Server**.

- Server URL: `http://127.0.0.1:8787`
- Server token: the contents of `.nyte-token.local` in this package

On macOS, copy the token without printing it:

```sh
pbcopy < packages/demo/server/cloudflare/.nyte-token.local
```

Create a chat in the connected server environment. The host advertises durable
history and chat capability. It has no workspace, filesystem, or terminal
backend. History remains in `.wrangler/state` across dev-server restarts.

## Read the code top down

1. [src/index.ts](src/index.ts) checks the bearer token in the Worker, routes
   to one named DO, and configures `NyteDurableObject` from
   [`@nyte-ai/cloudflare`](../../../cloudflare/README.md). The package opens DO
   SQLite, creates Nyte, serves the desktop protocol, and drives `sdk.advance()`
   from the DO alarm.
2. [src/models.ts](src/models.ts) loads the synced model and supplies its Codex
   provider and streaming function.
3. [scripts/dev.ts](scripts/dev.ts) forwards the Codex response endpoint through
   Node for this local OAuth test. It does not run the agent loop or store chats.

The local Node transport is necessary because Codex rejected the request sent
directly by workerd in this test. It preserves request compression and streams
the provider reply back to the DO. The Worker uses the fixed loopback transport
address. This demo runs locally with your Nyte Codex sign-in.

Wrangler aliases Photon's Node build to its workerd build. TypeBox runs in
interpreted mode because workerd disallows request-time code generation.

## Verify

With the dev command running:

```sh
pnpm --dir packages/demo/server/cloudflare check
pnpm --dir packages/demo/server/cloudflare test:provider
```

The provider check creates a `Wrangler local test` chat, sends a keyed prompt
twice, waits for alarm-driven completion without an open watch, replays the
saved SSE events, and reads the reply from SQLite. It makes one real Codex
request. The chat remains available for desktop inspection.

```sh
pnpm --dir packages/demo/server/cloudflare typecheck
pnpm --dir packages/demo/server/cloudflare build
```

The build is a Wrangler dry run and does not deploy anything. Generated runtime
types, model metadata, credentials, and local SQLite data are ignored by Git.
