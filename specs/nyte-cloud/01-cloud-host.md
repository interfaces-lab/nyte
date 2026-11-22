# 01 Cloud host

The always-on process that holds an organisation's sessions and runs their agent loops.

## Composition

```ts
const store = postgresStore({ connectionString: env.DATABASE_URL });

const host = await composeHost({
  store,
  models: createModels({ credentials: credentialStore(store, secrets) }),
  plugins: [cloudEnvironment({ pool: boatPool(env), workers }), localHands({ workers })],
  workspace: { kind: "cloud", locator: null },
  poll: 1000,
  secrets,
  home: null,
  description,
});
```

This follows the Vercel template (`packages/examples/vercel/server/utils/host.ts`) with three differences:

- `execution` is the default `run`, not `dispatch`. One process runs every session, because it is always on.
- The environment is `cloudEnvironment` ([03-remote-environment](03-remote-environment.md)), not `sandboxProvider`.
- The process also serves the relay that workers dial ([02-worker](02-worker.md)).

## One host per organisation

- A Clerk organisation owns one cloud host. A person on their own gets a personal organisation.
- One process per organisation means `client.perform` and the worker registry stay in one process. Several processes sharing one store would need both to work across processes.

## Auth

The listener uses the custom auth that already exists (`ListenOptions.auth`, `packages/core/src/contract/host.ts`):

```ts
auth: {
  kind: "custom",
  async authorize(request) {
    const claims = await verifyClerkJwt(request);          // JWKS, issuer, azp, org
    if (claims === null) return { deny: "unauthorized" };
    if (claims.org !== organisation) return { deny: "forbidden" };
    return { principal: asId(`user:${claims.sub}`), authority: PARTICIPANT_AUTHORITY };
  },
},
```

- A principal is a person (`user:<clerk id>`), not a device. That removes the phone-versus-Mac problem from the `local_bash` work.
- Owners of the organisation get `owner` authority, for model logins and settings.

## Where it runs

- **v1:** a Boat `small` machine with auto-stop off, about $13 a month. Its public address is `https://<id>-<port>.on.boat.dev`. Boat has no custom domains, and the address survives a resume.
- **Store:** managed Postgres, outside Boat. The process keeps nothing it can't rebuild, so a restart costs a reconnect, not data.
- Boat has no SLA. When that matters, move the process to any Node host. Nothing else changes.

## Model credentials

Model logins live in the host's credential store, encrypted with `NYTE_SECRET_KEY`. They never reach a worker. A worker runs tools only.

## Acceptance

- A phone signed in to the organisation lists and continues its chats while every machine is stopped.
- Restarting the process loses no message. Runs carry on under the existing restart recovery in core.
- A request without a valid Clerk JWT for this organisation is refused.
