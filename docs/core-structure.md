# Core structure

`packages/core/src` is `@nyte-ai/core`: sessions, runs and execution over a store. Each folder sits in one layer and may import folders in its own layer or below, never above, type-only imports included; `pnpm layers` fails otherwise. Core's entry in `scripts/check-layers.mjs` sets the order, lowest first. Add a new folder there and to the table below. Tests are in `packages/core/test`, outside the layers.

## Folders

| Layer | Folder | Owns | Start at |
| --- | --- | --- | --- |
| 0 | `util/` | Helpers with no domain: content hashing, code-point ordering and user text, iterables, clipping, line diffs, JSON Schema checks, trace spans, usage sums, the process environment, callables and the dev log | `content.ts`, `trace.ts` |
| 1 | `contract/` | Types, record schemas and their decoders, and the `Kernel` shape every layer above agrees on, including the presence types it exposes | `kernel.ts`, `records.ts` |
| 2 | `store/` | Ref names, the memory store, the log, blobs, catalogs, the session index, migrations, typed reads and writes of stored records, the part table, model state, the wait index, store inspection, head background, the project migration, a setting's stored layers, the secrets cipher, and reading stored children into the child table | `refs.ts`, `session.ts` |
| 3 | `fold/` | Log → `FoldState` → views: the fold, checkpoints, the bus, watch, and `commit`/`publish` | `fold.ts`, `commit.ts`, `watch.ts` |
| 4 | `engine/` | The kernel's state machines over `commit` (admission, session starts, receipts, runs, stop, the lease record, presence, jobs, waits), restart recovery, the in-memory job and child tables, and holding back and resuming this process's model requests | `admission.ts`, `runs.ts` |
| 5 | `env/` | Environments, workspaces and the scan cache's table, worktrees, trust, attachments, session changes, browser pages, MCP and variables | `environment.ts`, `workspaces.ts` |
| 6 | `extend/` | Plugins (activation, folders, runtime, API, part views), hooks, models, setting definitions and writes, resources and the context filter, workspace commands, the registry | `plugin-runtime.ts`, `registry.ts` |
| 7 | `builtins/` | The plugins core ships | `system-prompt.ts` |
| 8 | `agent/` | One run's requests: transcript, prompt, compaction, the tool runner, `turn` and the agent loop | `turn.ts`, `agent-loop.ts` |
| 9 | `drive/` | The head driver: claiming and renewing head leases, sweeps, takeover, handing a run to `kernel.turn` | `execution.ts` |
| 10 | `api/` | The public interfaces (`Connection`, `Host`, `Session`, `Head`, `Part`, projects) and input validation | `connection.ts`, `session.ts` |
| 11 | `compose.ts`, `harness.ts`, `index.ts`, `server.ts`, `store.ts`, `testing.ts` | Composition and the package entries | `compose.ts`, `index.ts` |

## Placing code

- Code goes with the folder that owns its concept, at or above the lowest layer its imports allow and at or below the lowest layer of its importers. It goes to the lowest allowed layer only when no owner fits better.
- When lower code must call higher code, it calls a `Kernel` member that `createKernel` wires, as `engine/start.ts` calls `kernel.releaseWorktree` and `engine/receipts.ts` calls `kernel.stopStart`. Add a member only when no move keeps ownership.
- Every file directly in `fold/` feeds `FOLD_CODE`'s hash, so an edit there invalidates stored checkpoints. Put code in `fold/` only when it turns the log into state.
- A type and its implementation may share a file name across folders, such as `contract/presence.ts` and `engine/presence.ts`, or `store/children.ts` and `engine/children.ts`.
