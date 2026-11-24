# 02 Worker

`nyte worker` runs on a Boat machine or on a person's Mac. It serves one workspace's tools to one cloud host, over a connection it opens itself.

## Process

```
nyte worker --host https://<id>-<port>.on.boat.dev --token <worker token> --workspace <path>
```

1. Open a headless host on loopback with the local provider and the given workspace. It has no models and runs no sessions (`execution: { kind: "admit-only" }`).
2. Dial the cloud host with `RelayConnection` (`packages/connect/src/host/relay.ts`), pointing at the loopback port. The relay already carries the host's operations, streams and socket (`RELAY_OPERATIONS`, `RELAY_STREAMS`, `RELAY_SOCKET` in `@nyte-ai/connect/relay`). It has flow control and a body limit, and it reconnects with backoff from 1 s to 60 s.
3. Stay up until the cloud host closes the relay with a revoke code, or the process is stopped.

The worker is a relayed host, so the cloud host reaches it with the normal SDK client over a `fetch` that writes relay frames (`createTransport({ fetch })`, `packages/protocol/src/client/transport.ts`). No new wire protocol.

## Relay server in the cloud host

The broker's Durable Object is today the only server end of the relay (`services/connect-broker/src/relay-object.ts`, `relay-channel.ts`). The cloud host needs a Node version:

- It accepts the WebSocket at `/.nyte/workers`, authenticates the first frame with the worker token, and registers the worker under its machine key.
- It hands out a `fetch` per worker for the remote environment provider.
- It marks the worker gone on close, so that waits in [03-remote-environment](03-remote-environment.md) fail fast.

Share the frame handling with the broker instead of copying it. Move what both need into `@nyte-ai/connect/relay`.

## Worker tokens

| Worker | Token comes from | Lifetime |
| --- | --- | --- |
| Boat machine | The cloud host mints it when it starts the machine and passes it in the machine's `env`. The machine is created with `noEnv: true`, so none of Boat's account credentials are inside. | Until the machine is removed |
| Mac | `nyte worker connect <code>`: a single-use code the cloud host shows the person, valid 10 minutes | Until the person revokes it |

The cloud host keeps only a digest of each token, as `principals.pair` already does for devices.

## Git credentials on a Boat machine

- The worker gets a short-lived installation token for our GitHub App each time it pushes. The cloud host mints the token and passes it in the push call.
- No long-lived GitHub credential is ever stored on the machine.

## Acceptance

- A worker started with a valid token appears in the cloud host's worker registry within 2 s.
- Killing the worker's network for 30 s and restoring it reconnects without restarting the process.
- A revoked token closes the relay, and the worker exits non-zero.
