# Nyte on Vercel

One Vercel Function is the host. The instance's SQLite under `/tmp` holds
sessions for as long as the instance lives; Fluid compute keeps one instance
warm across requests, and an open watch keeps it alive while a run is driven.
A cold start begins with an empty store. This target is for trying the wire
from the desktop; a Postgres store is what makes it durable.

```
client ──HTTP/SSE──▶ api/index.mjs (one bundled function)
                        ├─ SqliteStore(/tmp/nyte.db)
                        ├─ createNyte(...).attach()
                        └─ createNyteServer(...).fetch
```

Workspace packages ship raw TypeScript, so `scripts/build.ts` bundles the
function with esbuild into `dist/`, a dependency-free Vercel project that the
platform deploys without installing anything.

## Deploy

```sh
cd packages/demo/server/vercel
pnpm exec vercel link                       # once; picks or creates the project
printf '%s' "$TOKEN" | pnpm exec vercel env add NYTE_TOKEN production
printf '%s' "$KEY"   | pnpm exec vercel env add ANTHROPIC_API_KEY production
pnpm deploy
```

`NYTE_MODEL` (default `anthropic/claude-opus-5`) is the model a session uses
until it declares one. Only providers with a key answer; the rest fail the run
with `Provider is not configured`.

## Connect the desktop

Settings › Server: paste the deployment URL and `NYTE_TOKEN`. The desktop
proves the token against `/v1/info` before saving it. Chats under the
sidebar's Cloud group are created on the server and run there.
