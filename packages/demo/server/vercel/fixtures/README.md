# Deterministic infrastructure fixture

This fixture uses the production HTTP host, PostgreSQL store, Workflow loop, and
step entrypoint. Its model returns `Fixture reply: <last user message>` without
network access or provider credentials. Provider behavior belongs to
`test:provider`, separately from infrastructure checks.

`build:fixture` copies the current app into the ignored `.fixtures/echo`
directory, replaces only `src/models.ts` with [echo.ts](echo.ts), and runs the
normal Nitro build. The generated app is rebuilt from source each time. There
is no maintained copy of the app or runtime test switch in production.

```sh
pnpm --dir packages/demo/server/vercel build:fixture
```

`pnpm --dir packages/demo/server/vercel test:build` builds the fixture and then
production, and checks the published Workflow manifest excludes the generated
fixture. This guards build isolation; it does not substitute for deployment.

For deployment coverage, link `.fixtures/echo` to a test project and supply its
Preview environment with `DATABASE_URL` and `NYTE_TOKEN`. Use a test database.
Provider credentials are unnecessary. Deploy the generated output as a preview:

```sh
pnpm --dir packages/demo/server/vercel exec vercel link --cwd .fixtures/echo
pnpm --dir packages/demo/server/vercel exec vercel deploy \
  --cwd .fixtures/echo --prebuilt --target preview
pnpm --dir packages/demo/server/vercel test:deployment \
  --url <immutable-preview-url> --token-file .nyte-token.local
```

For a protected preview, supply its `VERCEL_AUTOMATION_BYPASS_SECRET` in the
check's environment. The checker sends it as a header and never prints it.

The check refuses any default model other than `fixture/echo` before creating a
session. It verifies authenticated boot, durable storage metadata, idempotent
admission, completion without a connected stream, event replay, and a saved response read through a new
client. The named test chat remains for inspection. This command needs a running
preview and PostgreSQL; a successful local build does not prove deployment.

Local `test/infrastructure.test.ts` uses the same deterministic model, real
PostgreSQL SQL through PGlite, actual host composition, and the production
Workflow loop and step function. Its injected runtime opens a fresh SDK for
each step. It verifies a failed dispatch, duplicate admission, execution, and
reads through another host. It also verifies that one Workflow finishes an active
run and saves the queued follow-up response. It does not test Vercel queues or
network pools.

The scheduling unit tests cover suspension at the external Workflow boundary.
The Codex tests cover credential forwarding through the real provider adapter
with a simulated provider HTTP response. Neither makes a live-provider claim.

This separation follows [Eve's model and world suites](https://github.com/vercel/eve/blob/456715196751f1b26f3b95faa9d95f1bc9caedd4/e2e/README.md).
