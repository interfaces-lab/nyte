# Vercel

A Nitro app template that runs a Nyte host on Vercel. It keeps sessions in PostgreSQL and runs tools in a sandbox you supply.

## Deploy

1. Add your sandbox SDK to this package.
2. Replace the `boot` function in `server/utils/host.ts` with one over that SDK. The template's `boot` throws, so the sandbox workspace answers `unavailable` until you replace it.
3. Set the environment variables below in your Vercel project.
4. Build from `packages/examples/vercel`:

   ```sh
   pnpm exec nitro build --preset vercel
   ```

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | None, required | The PostgreSQL database that holds sessions |
| `NYTE_TOKEN` | None, required | The token clients send as `Authorization: Bearer <token>`. It needs at least 16 characters. |
| `CRON_SECRET` | None | The secret the repair cron sends. Vercel sends it when you set it. Without it, `/.nyte/repair` answers `unknown`. |
| `NYTE_SANDBOX` | `nyte` | The name of the sandbox the workspace runs in |
| `NYTE_SECRET_KEY` | None | A base64 32-byte key that encrypts stored secrets. Without it, model provider sign-ins and a plugin's `secrets.set` fail. |
| `NYTE_IDENTITY_KEY` | None | A base64 32-byte Ed25519 seed for identity challenges. Without it, `/.nyte/identity` answers `unknown`. |
| `NYTE_REPAIR_SCHEDULE` | `* * * * *` | The repair cron schedule, read when you build. Vercel's Hobby plan allows a daily schedule only. |

## How it works

- `nitro.config.ts` serves `server/`, compiles the workflow in `server/workflows`, lets functions run up to 300 seconds and schedules the repair cron.
- `server/routes/[...].ts` sends every path to the listener of a host that each function instance composes once. The host reads the store every second, so each instance sees the others' writes.
- The host runs with `dispatch` execution. After each commit, it starts the `driveHead` workflow in `server/workflows/drive.ts` for every head that a wake leaves with work to do. `driveHead` advances the head one step at a time and sleeps durably while the head waits. It ends when the head has nothing left to do or another instance holds it.
- The cron calls `GET /.nyte/repair` to dispatch again any head that a failed dispatch left owed. The route accepts only `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and answers anything else `unauthenticated`.
- Jobs run per instance. A client reads another instance's job only through its exit report.

## Development

```sh
pnpm --dir packages/examples/vercel test
pnpm --dir packages/examples/vercel typecheck
```
