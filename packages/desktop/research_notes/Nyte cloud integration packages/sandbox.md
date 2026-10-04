# Sandbox integrations for Nyte

## Which SDKs and lifecycle guarantees should the packages target?

### Takeaway
Target `@vercel/sandbox@3.5.1` and `@cloudflare/sandbox@1.0.0`. Cloudflare 1.0 is not the older `getSandbox` SDK: applications own their Durable Object and native Container lifecycle. Neither provider turns durable orchestration into surviving Linux processes. [V-package] [C-package] [C-architecture]

### Cited Findings

#### Provenance
- Both official repositories were newly cloned with `git clone --depth 1` into `/Users/workgyver/Developer/nyte-integration-references/vercel-sandbox` and `cloudflare-sandbox-sdk`. Inspected commits are Vercel `6fc8e16fd606beab8f99546482f11cc40c3e5a8e`, dated 2026-09-28, and Cloudflare `f9e972a14123bef3b93e9bb337bab6e83419fe7e`, dated 2026-09-30. Both working trees were clean after inspection. [V-commit] [C-commit]
- Repository manifests and the npm registry agree on latest versions `3.5.1` and `1.0.0`. Both packages declare Apache-2.0; root LICENSE files were inspected. Cloudflare registry `latest.gitHead` matches the inspected commit. Vercel registry does not provide `gitHead`, so its manifest version match is not proof of tarball/source identity. [V-package] [C-package] [V-registry] [C-registry] [V-license] [C-license]
- Cloudflare registry `next` still points to `0.13.0-next.776.1`, not latest 1.0.0. Some search results still say 1.0 is forthcoming and recommend `@next`. Do not select APIs by those snippets. The 1.0 public barrel exports Files, S3Mount, DirectoryBackup and related helpers, not Sandbox/getSandbox. [C-registry] [C-index] [C-old-docs]
- To explain the older APIs, `git fetch --depth 1 origin v0` fetched legacy source into the same Cloudflare clone without changing its checkout. Legacy SHA is `8b2cbb7848196b7967ce4cc1a6bbd426a500dcf7`, whose manifest says `0.12.10`. This is secondary evidence, not the recommended dependency version. [C-v0-package]

#### API and guarantee matrix
| Area | Vercel 3.5.1 | Cloudflare 1.0.0 |
|---|---|---|
| Create | `Sandbox.create` accepts name, source git/tarball/snapshot, image, env, resources, timeout, persistence and network policy. `createFromSnapshot` is also available. | Application obtains `env.SANDBOX.getByName(name)` and calls `ctx.container.start` inside its own DO. SDK does not provision it. |
| Reconnect | `Sandbox.get({name, resume})`; named `getOrCreate` first gets, then creates on missing state. Operations can automatically resume a stopped session. | Same DO name identifies the controller; `container.running` identifies whether execution currently exists. Recovering the DO is not recovering a process. |
| Snapshot | `sandbox.snapshot` stops the running sandbox; restore starts a new execution session. Persistent sandbox stop/resume automatically saves/restores filesystem state. | Native `snapshotContainer` and `start({containerSnapshot:{id}})` are app-owned. Example persists snapshot ID in DO storage and explicitly destroys the current execution. `DirectoryBackup` separately saves a directory to R2, including restore into another image. |
| Processes | `runCommand({cmd,args,cwd,env,detached,timeoutMs})`; Command exposes logs, wait, kill. Persist session ID and command ID to observe the original process. | Native `container.exec(argv, options)` yields execution/output. Durable process IDs, retained logs and reconnectable supervision are not SDK exports; the repository implements them as application examples. |
| Files | `readFileToBuffer` returns Buffer or null, `writeFiles`, and `sandbox.fs` offers Node-like helpers. | `new Files(container)` offers streamed binary `readFile`, `writeFile`, `stat/lstat`, `readDirectory`, `mkdir`, `rename`, removal. Requires matching `sandbox-shim` in the image and Worker `nodejs_compat`. |

Source locations for the matrix: Vercel `packages/vercel-sandbox/src/sandbox.ts:779-834, 843-900, 908-1043, 1090-1142, 1203-1279, 1319-1364, 1728-1743`; `session.ts:40-82`; `command.ts:185-249, 348-361`. Cloudflare `README.md:28-61, 79-89`; `docs/architecture.md:5-39, 54-59`; `packages/sandbox/src/files/files.ts:60-187`; `examples/checkpoint-workspace/src/index.ts:46-85`; `packages/sandbox/src/directory-backup/directory-backup.ts:60-67`. [V-lifecycle] [V-command] [V-run-options] [C-readme] [C-architecture] [C-files] [C-checkpoint] [C-backup]

- Vercel default session timeout is 5 minutes, maximum 45 minutes on Hobby and 24 hours on Pro/Enterprise. Persistent sandbox total lifetime can span sessions, but each resumed session gets a fresh runtime budget. Snapshot expiration defaults to 30 days after last use. Current pricing documentation takes precedence over the README for changing plan quotas. [V-limits] [V-persistence]
- Cloudflare has no fixed maximum container runtime, but inactivity and host lifecycle still terminate execution. Disk is ephemeral by default; restart after sleep starts from the image unless explicitly restored. OOM can restart an instance. Snapshots are immutable, maximum 20 GB, retained 30 days from creation or latest restore. [C-faq] [C-limits]
- Cloudflare's current process example uses a 10-minute application-selected inactivity timeout and alarm checks every minute. It explicitly states that requests keep execution awake, running processes do not. The example process registry and logs live on container disk and disappear when it stops. These are examples, not universal native defaults or public SDK guarantees. [C-process-controller] [C-processes]
- Legacy Cloudflare `getSandbox` is at `packages/sandbox/src/sandbox.ts:760-790`, `exec:4114`, `startProcess:4770`, `getProcess:4913`, `killProcess:4943`, `execStream:4980`, `writeFile:5085`, `readFile:5134`, `createSession:5842`, `createBackup:6838`, `restoreBackup:7291`, `destroy:2809`. Legacy default `sleepAfter` is 10 minutes; keepAlive uses heartbeats. Older command timeout documentation explicitly says closing/timing out a call leaves the command running. Do not map that timeout directly to Nyte's kill-on-timeout behavior. [C-v0-source] [C-old-docs] [C-old-commands]

### Inferences
- Store controller identity, execution generation, process identity and filesystem checkpoint identity separately. A stable sandbox name or DO ID proves none of the other three still exists. File snapshots must not be advertised as memory, open socket, or process checkpoints. [V-lifecycle] [C-checkpoint] [C-processes]
- Named Vercel `getOrCreate` is convenient, but it is not an exactly-once setup transaction. Source calls setup after creation, and may delete/recreate a named sandbox if its snapshot is missing. Do not use this fallback when reconnecting an uncertain mutating tool call. [V-lifecycle]

### Gaps
- No provider execution, SDK installation, tests, image builds or deployments were performed. Native Cloudflare Container types are platform-owned and absent from this package's public exports; verify native signatures against deployment-generated Worker types before implementation. Some direct Cloudflare Markdown fetches returned HTTP 403; primary source and official search results supplied the evidence instead.
- No process-survival SLA or exactly-once command guarantee was found. Do not invent either.

## How do the providers map to Nyte operations and builtin plugins?

### Takeaway
Keep Nyte's tool semantics and replace transport operations. The current checkout already has ReadOperations, WriteOperations, EditOperations and BashOperations, but its package exports and local path helpers prevent a clean external adapter today. [N-read] [N-write] [N-edit] [N-core-package] [N-paths]

### Cited Findings
- Current Nyte is `/Users/workgyver/Developer/nyte`, origin `https://github.com/interfaces-lab/nyte.git`, HEAD `addfa87d07dc80898cf1d4a039eec07afae2dc6a`. The installed executable resolves to `bin/nyte` and reports `0.0.12`. No matching installed docs index was found in checked native/npm candidates; checkout docs were not treated as installed docs. The checkout already has unrelated modifications. In particular current `bash.ts` and `plugins/index.ts` differ from HEAD, so the pinned links are baselines, not exact copies of those two local files. [N-head] [N-core-package]
- ReadOperations uses `readFile(path): Promise<Buffer>`, readable access, and optional image MIME detection at `packages/core/src/tools/read.ts:36-42`. WriteOperations reads text or undefined on missing file, writes text and recursively creates directories at `write.ts:26-45`. EditOperations reads Buffer, writes text and checks readable/writable access at `edit.ts:54-66`. Diff generation, non-overlapping exact replacement and newline handling belong to Nyte. [N-read] [N-write] [N-edit]
- Current local `packages/core/src/tools/bash.ts:93-112` requires streamed Buffer chunks, cwd, optional AbortSignal, timeout in seconds and env, returning `{exitCode:number|null}`. Its current comments and implementation require timeout/cancelled ToolError, and signal exits use `128 + signal`. HEAD's analogous interface is at lines 72-93 and differs in error semantics. Local SHA-256 was `ff6ec8e033eca86c8b14f6ad5686b6f12362a0fe9cc8b0a587b2bc6eaa4aa157`. [N-bash-local] [N-bash-baseline]
- `toolsFsPlugin()` registers read as `replay:"safe"` and bash/edit/write as `replay:"never"`, with no operations options. Host resolution unconditionally installs it before extra plugins at `packages/host/src/plugins.ts:80-103`. Registry contributions support set/update/delete/wrap, and replay in activation order. An execute wrapper cannot retrofit the operations captured inside a local tool factory. [N-builtin] [N-host] [N-plugin-types] [N-registry]
- Tool factories and operation interfaces are not exported by current core package entrypoints. `core/package.json` has no tools subpath; `plugins/index.ts` exports builtin toolsFsPlugin but not its tool factories. Local plugins barrel SHA-256 was `b495a0097febf36c952340d4cf4af86040ba73735fdd761981bbea347cbc87bc`. [N-core-package] [N-plugins-local] [N-plugins-baseline]
- Read path resolution checks the host filesystem for variants, tilde expansion uses host home, and paths use host-native `node:path`. Mutation queues use host `realpath` and an in-memory Map, not remote canonical paths or distributed locks. [N-paths] [N-queue]

### Inferences

Recommended concrete mappings, after adding an explicit supported tool-factory/operations entrypoint:

| Nyte operation | Vercel mapping | Cloudflare 1.0 mapping |
|---|---|---|
| read Buffer | `readFileToBuffer({path})`; null becomes ENOENT | `Files.readFile(path)` then consume Response bytes and convert at Nyte's Buffer boundary; preserve late stream errors |
| write read-old-text | Buffer read + UTF-8; only missing becomes undefined | Same; recognize `SandboxFileError.is(error)` and only ENOENT becomes undefined |
| write text | `writeFiles([{path,content}])` | `Files.writeFile(path,content)` |
| recursive mkdir | `sandbox.fs.mkdir(path,{recursive:true})`, discard return | `Files.mkdir(path,{recursive:true})` |
| readable/writable access | Remote `test -r` / `test -w` as applicable, passing path as an argv parameter | Execute the corresponding checks under the same uid/gid as actual IO; stat alone is not an access check |
| image MIME | Detect from the fetched remote bytes, cache within a call if useful; never consult host disk | Same |
| bash | Explicit `/bin/bash -lc command`, cwd/env, detached Command + logs + wait + controlled kill; convert seconds to timeoutMs | Explicit shell argv via native exec, stream output, await exit and control cancellation; use app-owned process IDs only for reconnect extension |

These mappings are design recommendations based on the operation interfaces and provider implementations. Vercel `fs.access` only runs `test -e`, so it is not equivalent to Nyte's R_OK/W_OK checks. Cloudflare writes open/truncate before consuming input and can leave partial contents on failure. [N-read] [N-write] [N-edit] [V-fs-access] [V-fs-mkdir] [V-run-options] [V-command] [C-files]

- Fix or inject remote POSIX path resolution and remote queue identity before claiming parity. Constrain paths in the container, including symlinks if confinement is promised. A textual workspace-prefix check does not stop a symlink escape. Avoid forwarding host env wholesale; accept explicit env values only. [N-paths] [N-queue] [C-architecture]
- Prefer host composition replacing toolsFsPlugin, or add operations options to that builtin. An interim ordered plugin can replace the four tool definitions using `api.tools.add(draft => draft.set(...))`, but it still needs exported factories and a remote cwd prompt override. Retain existing approval hooks and replay settings. [N-host] [N-plugin-types] [N-registry] [N-builtin]
- Do not claim `@nyte-ai/core` runs unchanged in Workers. Its current factories depend on Node filesystem, process and image helpers. Cloudflare's Worker should expose a small execution/file RPC boundary; a Node-hosted Nyte adapter can consume it. A fully Worker-hosted Nyte runtime needs separate runtime compatibility work. [N-core-package] [N-read] [N-bash-baseline] [C-architecture]

### Gaps
- Baseline GitHub links cannot reproduce uncommitted Nyte behavior. The local file links, line numbers and hashes above identify that evidence honestly. No existing local modifications were changed.
- Error mappings, remote image processing and cancellation races need integration verification. Current Read/Write/EditOperations do not accept per-call AbortSignal, so injecting IO cannot alone provide in-flight file cancellation. [N-read] [N-write] [N-edit]

## What should Nyte wrap, implement and expose publicly?

### Takeaway
Use provider sandbox subpaths, not separate provider-specific sandbox packages. Keep orchestration adapters independent from command execution and require explicit lifecycle ownership. This is a design recommendation, not an existing Nyte API.

### Cited Findings
- Vercel supplies VM lifecycle, snapshots, filesystem transfer, command handles and Workflow serialization. Cloudflare supplies file protocol/storage helpers while leaving lifecycle, retries and process supervision to the application. There is no reason for Nyte to copy their HTTP clients, archive formats or filesystem shim. [V-lifecycle] [V-command] [C-architecture]
- Vercel's fetch retry helper retries network errors, 429 and 5xx twice by default. Command submission is POST; inspected create/command request parameters expose no user operation-id/idempotency-key field. This is not evidence of server-side exactly-once execution. Cloudflare explicitly leaves retries to applications because dropped/cancelled operations may already have changed files. [V-retry] [V-command-post] [C-architecture]
- Cloudflare's process example reserves an ID using nonrecursive mkdir, then writes metadata and launches the process. Duplicate IDs return conflict, but the reservation is execution-local and is not atomic with launch. DirectoryBackup serializes operations per Container and explicitly does not start, retry or time out execution. [C-processes] [C-backup]

### Inferences

#### Package responsibilities and minimal public API
- `@nyte-ai/vercel/sandbox`: `createVercelSandboxBackend({sandbox, cwd})`. Accept a caller-created SDK Sandbox and wrap it, rather than silently creating/billing resources. Keep provider-specific lifecycle methods on the caller's SDK handle.
- `@nyte-ai/cloudflare/sandbox`: `createCloudflareSandboxBackend({client, cwd})` for Node Nyte hosts. Client is an authenticated application-owned Worker bridge, not a nonexistent Cloudflare 1.0 Sandbox export.
- `@nyte-ai/cloudflare/sandbox-worker`: `createCloudflareExecutionService({container, files})` to expose the neutral contract inside an application DO. Keep this static-import entrypoint free of Node-host/core imports. Application owns namespace bindings, image/shim, auth, tenant IDs, inactivity policy and snapshots.
- Shared Nyte tool wiring should expose `sandboxToolsPlugin({backend,cwd})` once core has a supported operations/factory entrypoint. Do not duplicate edit algorithms, truncation, schema definitions or approval policy in each provider package.
- Root provider packages can later own Vercel Workflow or Cloudflare Workflow/DO orchestration integrations. No execution SDK imports at their root. Publish a separate `@nyte-ai/sandbox` only if execution acquires an independent consumer base/release schedule; two small adapters do not yet justify it.

Proposed provider-neutral execution contract, intentionally smaller than either SDK:

```ts
type ExecutionOutcome =
  | { kind: "exited"; exitCode: number }
  | { kind: "stopped"; reason: "timeout" | "cancelled" }
  | { kind: "lost"; executionId: string };

type OutputChunk = {
  stream: "stdout" | "stderr";
  bytes: Uint8Array;
};
```

The backend offers `readFile({path}) -> Uint8Array`, `writeFile({path,bytes})`, `mkdir({path,recursive})`, `access({path,mode:"read"|"read-write"})`, and `run({command,cwd,env,timeoutMs,signal,onOutput}) -> ExecutionOutcome`. File calls should also accept signals. Require explicit env as `Record<string,string>`; no host-global credentials in this object. Byte arrays avoid imposing Node Buffer on Worker code. Derive Nyte's operation bundle types from the supported exports, with no casts or `any`.

- `run` means execute once with no hidden retry after an ambiguous submission failure. Report uncertainty/lost execution separately from nonzero exit. A transport failure must never fabricate exit code 0. Preserve known signal numbers as `128 + signal` at the Nyte boundary; unknown loss remains unknown.
- Timeout starts at a documented point and is milliseconds in the backend, seconds at Nyte's BashOperations boundary. Kill the process on timeout/cancellation, settle output streams, then translate to current Nyte ToolError. Where kill cannot be confirmed, report uncertainty rather than successful cancellation. Command.kill alone is not proof that every child/grandchild died; use process-group control or explicitly document the weaker guarantee.
- Vercel detached Command is preferable to the synchronous run path for streaming with bounded adapter memory and explicit command identity. `session.ts:426-459` accumulates full stdout/stderr for the synchronous path, while detached mode yields a handle. Observe the pinned Session/Command after launch, not an auto-resuming named Sandbox that can bind a new execution. [V-run-implementation] [V-command] [V-lifecycle]
- Reconnect is an optional capability, not part of baseline `run`. A future `start/getProcess/logs/wait/kill` extension must carry execution generation and distinguish running, exited and lost. Vercel maps to sessionId + commandId; Cloudflare 1.0 needs app-owned execution-local supervision or persisted log artifacts. Do not silently rerun a lost process.
- Checkpoints should be optional, provider-specific filesystem capabilities with an explicit `stopsExecution` property. Exclude generic `pause/resume` and process restoration from the common contract. Cloudflare R2 directory backup and native container snapshot are different persistence choices, not synonyms.
- Persist durable operation records outside the execution for mutating tools. Useful states are pending, submitted, completed and uncertain, keyed by Nyte call ID plus execution generation. These records aid reconciliation, but cannot make provider launch and record commit atomic. Avoid describing this as exactly-once. Keep bash/edit/write `replay:"never"` absent proven reconciliation. A read replay is safe from side effects, not guaranteed to reproduce the original bytes. [N-builtin] [V-command-post] [C-processes]

### Gaps
- No provider-neutral atomic file CAS or launch idempotency contract was established. Exactly-once side effects, distributed edit locking, process-tree kill, full log replay and cross-session process recovery are deliberately not promised.
- These packages and API names are proposals. This task wrote only research notes; it installed no dependencies, executed no upstream code, read no secrets and modified no Nyte source.

[V-commit]: https://github.com/vercel/sandbox/commit/6fc8e16fd606beab8f99546482f11cc40c3e5a8e
[C-commit]: https://github.com/cloudflare/sandbox-sdk/commit/f9e972a14123bef3b93e9bb337bab6e83419fe7e
[V-package]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/package.json#L1-L75
[C-package]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/package.json#L1-L29
[V-registry]: https://registry.npmjs.org/@vercel%2fsandbox
[C-registry]: https://registry.npmjs.org/@cloudflare%2fsandbox
[V-license]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/LICENSE
[C-license]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/LICENSE
[V-lifecycle]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/sandbox.ts#L779-L1743
[V-command]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/command.ts#L185-L361
[V-run-options]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/session.ts#L40-L82
[V-run-implementation]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/session.ts#L423-L499
[V-fs-access]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/filesystem.ts#L602-L612
[V-fs-mkdir]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/filesystem.ts#L347-L364
[V-retry]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/api-client/with-retry.ts#L10-L101
[V-command-post]: https://github.com/vercel/sandbox/blob/6fc8e16fd606beab8f99546482f11cc40c3e5a8e/packages/vercel-sandbox/src/api-client/api-client.ts#L324-L359
[V-limits]: https://vercel.com/docs/sandbox/pricing#runtime-limits
[V-persistence]: https://vercel.com/docs/sandbox/concepts/persistent-sandboxes
[C-index]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/src/index.ts#L1-L36
[C-readme]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/README.md#L28-L89
[C-architecture]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/docs/architecture.md#L5-L77
[C-files]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/src/files/files.ts#L60-L187
[C-checkpoint]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/examples/checkpoint-workspace/src/index.ts#L46-L85
[C-backup]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/packages/sandbox/src/directory-backup/directory-backup.ts#L60-L67
[C-process-controller]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/examples/process-workspace/src/index.ts#L9-L138
[C-processes]: https://github.com/cloudflare/sandbox-sdk/blob/f9e972a14123bef3b93e9bb337bab6e83419fe7e/examples/process-workspace/src/processes.ts#L4-L156
[C-faq]: https://developers.cloudflare.com/containers/faq/
[C-limits]: https://developers.cloudflare.com/containers/platform/limits/
[C-old-docs]: https://developers.cloudflare.com/sandbox/configuration/sandbox-options/
[C-old-commands]: https://developers.cloudflare.com/sandbox/api/commands/
[C-v0-package]: https://github.com/cloudflare/sandbox-sdk/blob/8b2cbb7848196b7967ce4cc1a6bbd426a500dcf7/packages/sandbox/package.json#L1-L24
[C-v0-source]: https://github.com/cloudflare/sandbox-sdk/blob/8b2cbb7848196b7967ce4cc1a6bbd426a500dcf7/packages/sandbox/src/sandbox.ts
[N-head]: https://github.com/interfaces-lab/nyte/commit/addfa87d07dc80898cf1d4a039eec07afae2dc6a
[N-read]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/read.ts#L36-L100
[N-write]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/write.ts#L26-L105
[N-edit]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/edit.ts#L54-L170
[N-bash-local]: file:///Users/workgyver/Developer/nyte/packages/core/src/tools/bash.ts#L93-L112
[N-bash-baseline]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/bash.ts#L72-L142
[N-builtin]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/plugins/builtin/tools-fs.ts#L13-L27
[N-host]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/host/src/plugins.ts#L80-L103
[N-plugin-types]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/plugins/types.ts#L45-L71
[N-registry]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/plugins/registry.ts#L20-L83
[N-core-package]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/package.json#L1-L42
[N-plugins-local]: file:///Users/workgyver/Developer/nyte/packages/core/src/plugins/index.ts
[N-plugins-baseline]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/plugins/index.ts
[N-paths]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/support/path-utils.ts#L49-L150
[N-queue]: https://github.com/interfaces-lab/nyte/blob/addfa87d07dc80898cf1d4a039eec07afae2dc6a/packages/core/src/tools/support/file-mutation-queue.ts#L10-L55
