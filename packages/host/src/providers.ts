import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { EnvironmentProvider, ExecutionEnv, GitApi, SnapshotsApi } from "@nyte-ai/core";

/** Returns one booted or joined sandbox, what `sandboxProvider`'s `boot` answers: its identity (the one the provider's `inspect` answers for its target), its working directory, its files over the remote `FilesApi` contract (paths relative to `cwd`, §41j), its processes as jobs, `destroy`, which tears the sandbox down with its files and processes, and the optional `git` and `snapshots` seams of a sandbox that can serve them (§42c, §42n; paths relative to `cwd` too). */
export type SandboxHandle = Pick<ExecutionEnv, "identity" | "cwd" | "files" | "exec"> & {
  readonly git?: GitApi;
  readonly snapshots?: SnapshotsApi;
  destroy(): Promise<void>;
};

/** Returns the chat-only environment provider (`kind: "chat-only"`), node-free: a workspace with no files and no processes, for a host that only chats (a Durable Object). `inspect` answers any target with identity `"chat-only"`, `available` and no project sources; `attach` answers an `ExecutionEnv` with that identity and `cwd` `/` whose `files` see nothing — `read` answers `missing`, `stat` null, `bytes` throws `SdkError("unknown")`, `scan` and `search` answer `complete` alone, `find` no entries, `watch` yields nothing until its caller returns, `format` answers `unavailable { reason: "unsupported" }` — and refuse every change (`write`, `remove`, `upload` and a batch's `apply` throw `SdkError("unavailable")`), whose `exec` throws `SdkError("unavailable")`, and whose `close` resolves. No `git`, `snapshots`, `browser` or `destroy`. */
export function chatOnlyProvider(): EnvironmentProvider {
  throw new Error("not implemented");
}

/** Returns an environment provider over remote sandboxes (`kind` default `"sandbox"`), node-free. `inspect` is `options.inspect`, else it answers the content hash of the target (core's `objectId`) as its identity, `available` and no project sources, booting nothing. `attach(target)` joins the sandbox this provider already booted for the target or boots it with `boot(target)` (one boot in flight per target, keyed by that hash; a failed boot is forgotten so the next attach boots again) and answers an `ExecutionEnv` with the handle's `identity`, `cwd`, `files` and `exec`, whose `close` detaches and leaves the sandbox running. `git` and `snapshots` are on the provider, `(env) => handle.git` and `(env) => handle.snapshots` for the handle behind an environment it attached (§42c, §42o): a handle that has a seam serves it (`git` `available` to the workspace, snapshots taken around each run), and one without answers `undefined`, which the workspace sees as `git` `unsupported` and no snapshots — the baseline's "required for local and sandbox" unmet for that sandbox. `destroy(target)` calls the handle's `destroy` (joining the sandbox through `boot` first when this provider holds none for the target) and forgets it. No `browser`. */
export function sandboxProvider(options: {
  readonly kind?: string;
  boot(target: WorkspaceTarget): Promise<SandboxHandle>;
  readonly inspect?: EnvironmentProvider["inspect"];
}): EnvironmentProvider {
  throw new Error("not implemented");
}
