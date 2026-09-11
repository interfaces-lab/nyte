# Nyte on Cloudflare

One Durable Object is the host. Its SQLite holds every session, it attaches
the runner that drives them, and `@nyte-ai/server` answers the wire. The
Worker in front forwards every request to that object, so a session's
watchers and its runner share one process and `watch` needs no polling.

```
client ──HTTP/SSE──▶ Worker ──▶ NyteHost (Durable Object)
                                   ├─ SqlStore over ctx.storage.sql
                                   ├─ createNyte(...).attach()
                                   └─ createNyteServer(...).fetch
```

## Run

```sh
pnpm --dir packages/demo/server/cloudflare dev
```

Local secrets go in `.dev.vars` (ignored):

```
NYTE_TOKEN=<at least 16 characters>
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

`NYTE_MODEL` in `wrangler.jsonc` is the model a session uses until it
declares one. Only providers with a key answer; the rest fail the run with
`Provider is not configured`.

## Deploy

```sh
cd packages/demo/server/cloudflare
pnpm exec wrangler secret put NYTE_TOKEN
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm deploy
```

## Connect the desktop

Settings › Server: paste the Worker URL and `NYTE_TOKEN`. The desktop proves
the token against `/v1/info` before saving it. Chats under the sidebar's
Cloud group are created on the server and run there.

Sessions on either host have no workspace and no tools: a system prompt and
the provider's context policies, nothing that needs a filesystem.
