# Nyte on Vercel

The HTTP handler serves the Nyte wire, PostgreSQL stores shared session state,
and Vercel Workflow runs accepted work independently of desktop connections.

```text
desktop ── HTTP/SSE ──▶ HTTP function ──▶ PostgreSQL
                             │                 ▲   nyte_* tables + nyte_dispatch outbox
                             ├─ Workflow ──────┘
                             │  one sdk.advance() per step
   cron ── /v1/reconcile ────┘  redispatches orphaned outbox rows
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
| `CRON_SECRET` | Vercel sends it on cron requests to `/v1/reconcile`. Without it the route answers 401. |
| `NYTE_MODEL` | Default provider/model; defaults to `vercel-ai-gateway/thinkingmachines/inkling` at medium thinking |
| `AI_GATEWAY_API_KEY` | Optional Vercel AI Gateway key; project OIDC needs none |
| `OPENROUTER_API_KEY` | Optional OpenRouter key |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Optional direct provider keys |

The host refuses to start without `DATABASE_URL`; there is no temporary
filesystem fallback. It initializes its `nyte_*` tables inside the supplied
database.

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

## Provider credentials

The host authenticates to models with its own credential, never a user's
subscription sign-in. Local OAuth sign-ins stay on the desktop. In order of
preference:

1. Vercel AI Gateway with project OIDC. There is no secret to provision: each
   function request carries a fresh `VERCEL_OIDC_TOKEN`, which the host reads at
   request time. Older projects may need Settings › Security › **Secure backend
   access with OIDC federation** enabled. Select a gateway model with
   `NYTE_MODEL=vercel-ai-gateway/<model>`.
2. `AI_GATEWAY_API_KEY` for the same gateway models; it takes precedence over
   OIDC.
3. `OPENROUTER_API_KEY` with `NYTE_MODEL=openrouter/<model>`.
4. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` with the matching `NYTE_MODEL`.

Gateway and OpenRouter model ids contain slashes; the provider is everything
before the first one. Then deploy:

```sh
pnpm --dir packages/demo/server/vercel run deploy
```

`run deploy` builds the Vercel output and uploads it with `vercel deploy
--prebuilt --prod`. The linked project's production domain is
`https://nyte-server.vercel.app`. Deployment-specific URLs can require Vercel
sign-in, so use the production domain in Nyte clients.

## Check and test

Check reachability, durable storage, and, through the `provider.status`
operation, that the host's model credential is accepted by its provider. The
check makes no model request and creates no chat:

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

Start the local desktop with `pnpm dev:desktop`. In Environments › Connections, enter
the production domain and `NYTE_TOKEN`. The row distinguishes server access,
connection failures, and storage classification. Cloud's model picker reads the
server's SDK catalog, including available models, pricing, and thinking levels.
Local provider sign-ins do not configure the server automatically.

Create a Cloud chat, send a short message, and reopen it after switching chats.
Closing a watch disconnects that client; it does not cancel the Workflow. Use
the chat's stop action to request an abort.

## Dispatch is durable

Every mutating request records a row in `nyte_dispatch` before admission, starts
the Workflow, then deletes the row. A crash anywhere after admission leaves the
row; the input is durable and so is the obligation to step it. A Vercel cron
calls `/v1/reconcile` every minute with `Authorization: Bearer $CRON_SECRET`,
and a cold HTTP instance runs the same reconciliation once its runtime has
opened. Reconciliation claims rows older than 60 seconds and dispatches them;
a row older than 15 minutes is deleted after a successful wake, since no
admission can still be committing by then. A duplicate Workflow is harmless: the fenced step
returns `busy` or `idle`.

Vercel runs cron jobs only for production deployments, not previews. Hobby plans
reject schedules more frequent than once a day, so the default every-minute
schedule needs Pro or Enterprise. On Hobby, build with
`NYTE_RECONCILE_SCHEDULE="0 4 * * *"` for a daily backstop and rely on cold-start
reconciliation or an external scheduler calling `/v1/reconcile` for faster
repair. Previews still reconcile on cold start, so a preview sharing the
production `DATABASE_URL` dispatches production rows with preview code; give
previews their own database.

Retrying a failed request with its original idempotency key still works and
returns `duplicate`, but no client has to return for accepted work to run.
Incompatible persisted-format changes still require an explicit upgrade policy;
this example does not add migrations for older prototypes' temporary SQLite
databases.
