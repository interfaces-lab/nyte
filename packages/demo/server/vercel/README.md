# Nyte on Vercel

The HTTP handler serves the Nyte wire, PostgreSQL stores shared session state,
and Vercel Workflow runs accepted work independently of desktop connections.

```text
desktop ── HTTP/SSE ──▶ HTTP function ──▶ PostgreSQL
                             │                 ▲
                             └─ Workflow ──────┘
                                one sdk.advance() per step
```

Each Workflow step reads current state under core's fenced lease, performs one
kernel step, and closes its SDK and database pool. Completed runs continue into
queued user messages until idle. Provider retry dates, timed waits, and busy
leases use durable Workflow sleep. An undated wait ends the Workflow; a reply
dispatches it again. The Workflow journal carries session/head IDs and scheduling
outcomes. Conversation content and provider credentials stay in PostgreSQL and
runtime secrets.

Nitro and `workflow/nitro` generate separate HTTP, Workflow, step, and webhook
functions under `.vercel/output`. Core has no Vercel dependency. Hosted chat
currently has no workspace or filesystem tools.

The HTTP instance reuses its initialized host and pool. Pools are bounded and
registered with Vercel's `attachDatabasePool` so idle connections are released
before Fluid compute suspends the function. Workflow steps close their SDK and
pool after each bounded unit of work.

References: [Eve's execution model](https://github.com/vercel/eve/blob/456715196751f1b26f3b95faa9d95f1bc9caedd4/docs/concepts/execution-model-and-durability.mdx),
[Workflow's Nitro integration](https://workflow-sdk.dev/docs/getting-started/nitro),
and [Vercel's pool lifecycle guidance](https://vercel.com/kb/guide/connection-pooling-with-functions).

## Configure the project

Link this package to a Vercel project once:

```sh
pnpm --dir packages/demo/server/vercel exec vercel link
```

Production needs these environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Shared PostgreSQL connection string, with TLS configured by the provider |
| `NYTE_TOKEN` | Desktop bearer token, at least 16 characters |
| `NYTE_MODEL` | Default provider/model; defaults to `openai-codex/gpt-5.6-sol` |
| `OPENAI_CODEX_ACCESS_TOKEN` | Synced Codex OAuth access token for the default model |

For an API-key provider, use `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` and select
the matching `NYTE_MODEL`. The host refuses to start without `DATABASE_URL`;
there is no temporary filesystem fallback. It initializes its `nyte_*` tables
inside the supplied database.

One option is Neon through the Vercel Marketplace. Accept its terms in Vercel,
then create and connect a free database in the function's region:

```sh
pnpm --dir packages/demo/server/vercel exec vercel integration add neon \
  --name nyte-server-db --plan free_v3 \
  --metadata region=iad1 --metadata auth=false \
  --environment production --no-env-pull
```

The integration supplies `DATABASE_URL` to the project. An existing PostgreSQL
database works too. Set secrets through the Vercel dashboard or `vercel env add`;
do not put credentials in source, command arguments, or build output.

## Use the local Codex OAuth sign-in

Sign in to OpenAI Codex in the local Nyte desktop, then run:

```sh
pnpm --dir packages/demo/server/vercel sync:codex
pnpm --dir packages/demo/server/vercel run deploy
```

`sync:codex` copies only the local access token into the linked `nyte-server`
project's sensitive Production environment variable. It sets `NYTE_MODEL` to
`openai-codex/gpt-5.6-sol`; `--model <id>` selects another known Codex model.
The token goes to the Vercel CLI through stdin and is never printed or bundled.

The refresh token stays on the Mac. The command prints the copied token's
expiry. Repeat `sync:codex` and `run deploy` when it expires; refresh happens
under the local credential store's lock before copying. This subscription-auth
setup is for personal testing and does not implement hosted account sign-in.

`run deploy` builds the Vercel output and uploads it with `vercel deploy
--prebuilt --prod`. The linked project's production domain is
`https://nyte-server.vercel.app`. Deployment-specific URLs can require Vercel
sign-in, so use the production domain in Nyte clients.

## Check and test

Check authentication, host metadata, and the existing SDK model catalog without
creating a chat or calling a provider:

```sh
pnpm --dir packages/demo/server/vercel check \
  --url https://nyte-server.vercel.app --token-file .nyte-token.local
```

Run a real model request and verify provider access, streamed completion, and
the saved reply independently of the deterministic infrastructure tests:

```sh
pnpm --dir packages/demo/server/vercel test:provider \
  --url https://nyte-server.vercel.app --token-file .nyte-token.local
```

Both commands require the host to advertise durable storage. The live test leaves
one named chat available for inspection and never prints the token. Keep the
ignored token file readable only by your user, or set `NYTE_TOKEN` and omit
`--token-file`.

Package checks:

```sh
pnpm --dir packages/demo/server/vercel test
pnpm --dir packages/demo/server/vercel typecheck
pnpm --dir packages/demo/server/vercel build
```

The core PostgreSQL tests use a real embedded PostgreSQL engine. To additionally
exercise concurrent network pools against a provisioned database, set
`NYTE_TEST_POSTGRES_URL` and run:

```sh
pnpm --dir packages/core exec vitest run test/postgres-network.test.ts
```

That test creates a random session, checks competing writes, stale leases, and
reconnection, then deletes only its own session.

The local infrastructure fixture combines the actual chat host, PostgreSQL store,
and Workflow loop with an embedded PostgreSQL engine and deterministic provider.
The [fixture guide](fixtures/README.md) describes its coverage and the separate
`build:fixture` and `test:deployment` commands for an immutable preview. These
checks need no provider key, so provider failures do not gate infrastructure
checks. A local test or build does not establish that Vercel deployment works.

## Connect the desktop

Start the local desktop with `pnpm dev:desktop`. In Settings › Server, enter
the production domain and `NYTE_TOKEN`. The row distinguishes server access,
connection failures, and storage classification. Cloud's model picker reads the
server's SDK catalog, including available models, pricing, and thinking levels.
Local provider sign-ins do not configure the server automatically.

Create a Cloud chat, send a short message, and reopen it after switching chats.
Closing a watch disconnects that client; it does not cancel the Workflow. Use
the chat's stop action to request an abort.

Admission precedes Workflow dispatch. If dispatch or the response fails, retry
the message with its original idempotency key: the input remains durable and a
duplicate receipt dispatches again. Incompatible persisted-format changes still
require an explicit upgrade policy; this example does not add migrations for
older prototypes' temporary SQLite databases.
