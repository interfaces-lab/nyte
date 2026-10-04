# Execution environment

Where a tool call acts. One object per call, `call.env`, carrying a filesystem
and the shell that runs in it. Tools reach files and processes only through it,
never through anything captured when they were built. The lab's environments
prototype (This Mac, Studio, Cloud) is the picker for the same thing this doc
describes underneath.

Source: `packages/core/src/kernel/loop/env.ts` (the contract),
`packages/core/src/tools/env.ts` (the local implementation, `requireEnv`,
`withExecutionEnv`), `packages/core/src/plugins/registry.ts` (where every tool
gets one). Related: `refs/facts/cwd` in `packages/core/src/kernel/sdk/session-pool.ts`,
which this replaces over the steps below.

## Shape

```ts
interface ExecutionEnv {
  readonly fs: string;   // filesystem identity: equal values see the same files at the same paths
  readonly cwd: string;  // a path inside that filesystem
  readFile(path): Promise<Buffer>;
  writeFile(path, content): Promise<void>;
  mkdir(path): Promise<void>;                     // creates parents
  stat(path): Promise<FileInfo | undefined>;      // undefined when nothing is there
  readdir(path): Promise<string[]>;
  realpath(path): Promise<string | undefined>;
  exec(command, { onData, signal, timeout }): Promise<{ exitCode: number | null }>;
}
```

`fs` and the object are deliberately separate. The object answers "how do I
touch this disk"; `fs` answers "is this the same disk". The file mutation queue
serialises `edit` and `write` on `fs + canonical path`, so two env objects over
one disk share a queue and two disks with identical paths never wait on each
other. A fresh object per call is fine.

The local implementation is `createLocalExecutionEnv({ cwd })` with
`fs = "local:<hostname>"`. A container, VM, or remote host is another
implementation with its own `fs`.

## How a call gets one

```text
activate({ env: { cwd } })
  └─ createRegistries(createLocalExecutionEnv({ cwd }))
       └─ ToolMapDraft.set(id, tool)
            └─ withExecutionEnv(bindTool(tool), env)   ← every contributed tool, once, identity cached
                 └─ tool.execute(input, { ...call, env })
```

Binding time is the chokepoint: the jobs wrapper's inner `bash`, nested
`call.run.tools.execute`, and plugin `wrap`s all sit above it and see the same
env. `call.env` is absent only in the bare loop, like `call.run`.

The built-in tools take no `cwd` and no `operations`:

```ts
api.tools.add("read", { ...createReadToolDefinition(), replay: "safe" });
```

## What it replaced

| before | after |
| --- | --- |
| `ReadOperations`, `WriteOperations`, `EditOperations`, `LsOperations`, `BashOperations` | one `ExecutionEnv` |
| `createBashToolDefinition(cwd, { operations, shellPath, spawnHook })` | `createBashToolDefinition({ commandPrefix? })`; shell choice lives on the env |
| `cwd` closed over at `session(api)` | `call.env.cwd` at each call |
| image sniff that opened the file itself | sniff on the bytes `env.readFile` returned |
| mutation queue keyed on absolute path | keyed on `fs + realpath` |
| "[Image: original WxH, displayed at …]" and "[Image converted …]" text in tool output | gone; the image is bounded silently |

## Why not Pi Durable's shape

Pi Durable has the same object (`ExecutionEnv`) but reaches it through
`HarnessOptions.env`, a host closure the harness calls on every tool task,
reading a per-conversation document (`defineDoc`) to decide where. That fits a
harness with a single commit line, durable tasks, and typed documents. Nyte
skipped all three for git's four authorities: objects, refs, leases, events.

What carries over is the object, per-call resolution, and `fs` as a separate
identity. What does not: documents (a fact is a ref), a per-call host closure
(the activation is already lease-scoped), and a static `replay` flag as the
only replay guard (see step 2).

## Steps

Steps 1 and 2 are done. Each later step stands on its own.

| step | change | where |
| --- | --- | --- |
| 1 | `ExecutionEnv`, `call.env`, tools stop closing over `cwd`, local only | done |
| 2 | effect intent records `fs`; resume reruns a `replay: "safe"` call only when this runner's `fs` matches, else settles `interrupted` | done: `Effect.fs`, `decideRecovery(view, fs)`, `TurnOptions.env`, `Activation.env` |
| 3 | `refs/workspace` on the root session; activation resolves it; `requires/workspace_trust` generalises to `requires/workspace { ref, reason }` | `session-pool.ts`, `protocol` |
| 4 | relocate is a CAS on the root's ref; retire `refs/facts/cwd` | `relocate.ts` |
| 5 | first non-local `kind` on the server host | `host`, `server` |

### The workspace ref

```text
refs/workspace    on the root session only. Blob { fs, kind, locator, cwd }
```

- `fs` is the filesystem identity above.
- `kind` and `locator` are what the host needs to reopen it. The kernel stores
  them and asks; it never interprets them and never allocates.
- `cwd` is a path inside that filesystem.

## Decisions

**The host writes the ref.** A session created in a sandbox has its ref written
by whoever allocated the sandbox. The kernel asks the host to `open` it at
activation and gets an env or a requirement. Same division as trust today.

**Children inherit; there is no per-child workspace.** A child is a branch off
its parent and resolves up through `PARENT_FACT` to the root's one ref. Every
head in a session and every child under it shares it. Something that needs a
different place is a new root, not a branch. This is why the child-`cwd`
freeze in `resolveSessionActivation` goes away: a finished child is a leaf and
runs no tools; what it did is in its effects once intent carries `fs`.

**Current state in refs, history in objects.** The ref says where the tree acts
now. Effect intent says where each call acted. Nothing else records location.

**Moves wait for quiet.** Relocate is a CAS on the root ref, refused while any
head or child in the tree is live, which `relocate` already enforces. Every
activation in the tree closes and reopens on the new ref.

**Env lifetime is the activation's.** The activation is lease-scoped; lose the
head lease and the env closes; another runner, maybe another host, opens its
own. The host dedupes connections by `fs`. Nothing new fences this.

## Open

- `requires/workspace` reasons: `trust` (local), `unreachable`, `unsupported_kind`.
  A desktop opening a server-created sandbox session says `unsupported` rather
  than running local.
- `~` expansion in `resolveToCwd` still uses this machine's home directory. Fine
  for `local:*`; a remote env needs its own.
- The mutation queue is per process. Two hosts on PostgreSQL editing one file
  through one sandbox are not serialised by it; the head lease is what keeps
  them apart.
