# 04 Machine pool

Starting and stopping the machines that cloud chats work on. The rest of the design never names a provider.

## Interface

```ts
export interface MachinePool {
  /** Creates the machine for `key`, or resumes it if it is stopped. Repeating a call with the same key never creates a second machine. */
  start(input: {
    readonly key: string;
    readonly template: string;
    readonly env: Readonly<Record<string, string>>;
    readonly labels: Readonly<Record<string, string>>;
  }): Promise<Machine>;
  /** Stops the machine and keeps its disk. A stopped machine costs only storage. */
  stop(key: string): Promise<void>;
  /** Removes the machine and its disk. */
  remove(key: string): Promise<void>;
  /** What the provider says about `key`, without starting anything. */
  find(key: string): Promise<Machine | null>;
  /** What `key` has cost, for billing. */
  usage(key: string): Promise<{ readonly seconds: number; readonly cost: number }>;
}

export interface Machine {
  readonly key: string;
  readonly state: "starting" | "running" | "stopped" | "failed";
}
```

The key is `<org>:<person>:<repo>`. See the open question on machine granularity in the [README](README.md).

## Boat adapter

From Boat's API at `https://boat.dev/api/v1` (OpenAPI: `docs.boat.dev/openapi/boat-v1.yaml`), with the TypeScript SDK `@boatdev/sdk`:

| Pool call | Boat |
| --- | --- |
| `start`, new | `POST /sandboxes` from the saved snapshot `template`, with `Idempotency-Key: <key>`, `noEnv: true`, `env`, `labels: { nyte: key }`, `ttlSeconds: null` |
| `start`, stopped | resume the sandbox found by label |
| `stop` | stop. Boat runs the pre-stop hook and takes the final snapshot itself. |
| `remove` | `DELETE` with `X-Ascii-Confirm-Delete: <id>` |
| `find` | `GET /sandboxes?label=nyte=<key>` |
| `usage` | `GET /sandboxes/{id}/usage` |

Boat facts the adapter has to handle:

- **Idempotency.** Boat keeps idempotency keys for 24 hours. After that, `find` by label is what prevents a duplicate.
- **IP address.** It changes on every resume. The worker dials out, so nothing depends on it.
- **Auto-stop.** It counts from the last resume, not from activity. The host stops machines itself and sets `ttlSeconds: null`.
- **Starts.** They are capped per Boat account: 200 a day on the $20 plan, 2,400 on the $2,000 plan, and overage up to 6× at $0.03–$0.07 per start. Above 6× a start fails with 429, and Boat never queues it. The adapter reports 429 as `SdkError("unavailable", …, { retry: true })`, and the host counts starts per organisation.
- **Stopped disks.** Boat keeps them at least 14 days, and a resume after deletion fails with `409 snapshot_data_expired`. In that case the adapter creates a new machine from the template, and the worker clones again.
- **API key.** It expires after at most 365 days. Scope it to the `full-sandbox` actions plus `snapshot.read`.

## Templates

- One saved snapshot per repository, `nyte-<owner>-<repo>`, with `nyte` installed, the repository cloned and its setup run.
- A repository without one uses `nyte-base`.
- Refresh a template on a push to its default branch.

## Switching provider

A Daytona or Namespace adapter implements the same five calls. The worker, the relay and the environment provider don't change.

## Acceptance

- Calling `start` twice at once for one key leaves exactly one machine.
- `stop` then `start` brings back the same disk, and the same files are in the worktree.
- A 429 from Boat reaches the chat as a retryable error, not a failed run.
