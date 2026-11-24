# 03 Remote environment

An `EnvironmentProvider` (`packages/core/src/contract/workspace.ts`) whose environments are workspaces on workers. Core's tools call it the way they call the local provider.

## Target

A cloud chat's workspace target names the machine and the worktree:

```ts
{ kind: "cloud", locator: { machine: "<pool key>", repo: "<owner/name>" } }
```

The session's worktree isolation names the branch, as a local chat's does.

## Mapping

| `EnvironmentProvider` / `ExecutionEnv` | Worker call | Status |
| --- | --- | --- |
| `attach(target)` | Start the machine ([04-machine-pool](04-machine-pool.md)), wait for its worker, then `connection.workspace(id)` | new |
| `env.files` | `workspace.files()` | exists |
| `env.exec(command, options)` | `workspace.jobs.start({ command, pty })` and the job's `output`, `write`, `resize`, `stop`, `settled` | `cwd`, `env` and `stdio` are missing from `jobs.start` |
| `git(env)` | `workspace.git()` | exists |
| `language(env, trusted)` | `workspace.language()` | exists |
| `snapshots(env)` | none | missing: `capture`, `diff` and `patches` aren't wire ops |
| `worktrees` | none | missing: creating and removing a worktree isn't a wire op |
| `realpath(env, path)` | none | missing; optional |
| `inspect(target)` | Pool lookup, without starting the machine | new |
| `destroy(target)` | Pool `remove` | new |

## Wire additions

Each one exposes something the local provider already does:

1. `jobs.start` takes optional `cwd` and `env`, and `stdio: "merged" | "protocol"`.
2. `workspace.snapshots.capture`, `.diff`, `.patches`, matching `SnapshotsApi`.
3. `workspace.worktrees.create` and `.remove`, matching `WorktreeProvider`.

After changing them, run `pnpm --dir packages/bench bench:wire:gate` and `bench:snapshots:gate`.

## Waking

`attach` is where a sleeping machine wakes:

```
attach(target)
  pool.start(key)                    idempotent; resumes a stopped machine
  workers.until(key, 60 s)           resolves when its relay registers
  → ExecutionEnv over the relayed connection
```

- A tool call that finds no worker within 60 s fails with `SdkError("unavailable", "<machine> didn't start")`. The run sees an ordinary tool error.
- Two chats on one machine share one `attach`, through core's existing attachment slots.

## Sleeping

The cloud host stops a machine when all of these hold:

- No run is live in any session attached to it.
- No job is running on it (`Workspace.jobs.list()`).
- 3 minutes have passed since the last of these ended.

The check runs on the `run_ended` hook and on a 1-minute timer. Stopping goes through the pool, never through the worker.

## Acceptance

- Every tool in core's environment plugin (`read`, `write`, `edit`, `list`, `bash`, `job`) gives the same results on a remote environment as on a local one, checked as a table across tools.
- Rewinding a cloud chat restores files, through the snapshot wire ops.
- A `bash` started while the machine is stopped runs once the machine wakes, with no error shown to the person.
