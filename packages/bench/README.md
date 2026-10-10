# @nyte-ai/bench

Benchmarks for the guarantees in `packages/lab/sdk-shape.ts`. Each scenario
checks one thing the baseline promises that the old code could not, as an
invariant (must hold) and a metric (budgeted in `budgets.json`). The run fails
if either breaks.

It is isolated from the rewrite: it imports only `@nyte-ai/sdk` and a
`BenchDriver` from `@nyte-ai/host/bench`, has no `typecheck` or `test` script,
and never reaches into core. Until those two exist it declares no workspace
dependency, so `pnpm install` is unaffected; add `"@nyte-ai/sdk": "workspace:*"`
and `"@nyte-ai/host": "workspace:*"` when they land.

## Run

```sh
pnpm --dir packages/bench bench                       # all
pnpm --dir packages/bench bench -- stop-fence store-cas
```

Results land in `results/<timestamp>.json`. Exit code 1 on any failure.

## Scenarios

| scenario | baseline | invariant | metric |
|---|---|---|---|
| `store-cas` | §7 | two writers, one `expect`: exactly one `set`, one `stale`; `log(after)` is complete and ordered | `refs.set` per second; `log` read ms |
| `fold-token-throughput` | §2c guarantee 1 | a token changes one part; every other message keeps object identity across yields | p99 fold ms per token; yields per second |
| `watch-coalescing` | §2c guarantee 3 | no two yields closer than a frame; the last view is the whole text | yields per second |
| `initial-load` | §2c `ViewOptions.tail`, `history` | a 5,000-message session opens with exactly the tail; pages reassemble it once, in order | `view({ tail })` ms and bytes; page ms |
| `stop-fence` | §2 `Run.stop` fence | the next yield after `stop()` shows the run stopped; no later yield grows its text | `stop()` resolve ms; yields until stopped |
| `edit-mid-stream` | §2 editing | no view holds the old live tail and the new input together; a running child is untouched | views until the new input lands |
| `durable-tool-replay` | §4 durability | crash while a safe tool is parked on a job, restart: it settles ok, its memo ran once; a `never` tool is `interrupted` | restart-to-resume ms |
| `reconnect-resume` | §1 `connect` | drop the socket mid-stream: no gap, no repeat; a send made offline lands exactly once | resume ms |
| `git-patches-batching` | §3b `git.patches` | 500 paths cost ≤ ⌈500 / batch⌉ git reads; after a write the old entry stands in until the fresh one lands | host reads; full-expand ms |
| `sessions-directory` | §1 `sessions.watch({ limit })` | a rename on a 5,000-session host yields ≤ 50 rows containing the renamed one | yield bytes; rename-to-yield ms |

## What the host package must supply

`@nyte-ai/host/bench` exports a `BenchDriver` (see `src/driver.ts`): a memory
`Store`, the local environment provider over a temp directory, a `FakeModel`
that streams scripted text and tool calls on demand and can pause mid-stream,
`crash()`/`restart()` over the same store, a listener plus `connect()` whose
link can be dropped, counters (`gitDiffReads`, `bench_memo_runs`), and branded
id constructors. Two bench tools are registered: `bench_wait_job` (replay
`safe`; memos a value, starts a job, waits on it) and `bench_never` (replay
`never`; sleeps).

Fixtures are synthetic and removed on `close()`. No model requests leave the
process.

## Adding a scenario

One file in `src/scenarios/`, one `Scenario` with `name`, `guarantee` (the
baseline section and the sentence it checks), and `run`. Add its budgets to
`budgets.json` and its import to `src/main.ts`. A scenario without an
invariant is a number nobody can act on; give it one.
