import type { Plugin } from "@nyte-ai/core";

/** Returns the core plugin `bench` with the two bench tools. `bench_wait_job` (input `{ command: string }`, replay `safe`): memoises a value under `bench-memo` whose compute calls `onMemo()` (the `bench_memo_runs` counter, so a replay that recomputes shows), memoises the start of `command` as a job in the session's workspace (`jobs.start`), waits on it with `wait({ kind: "job", job })`, and settles ok with the job's end, `lost` included, so a re-run after a restart replays both memos and waits on the job it started. `bench_never` (input `{}`, replay `never`): sleeps 60 s under the call's signal, so a crash finds it running and the restart settles it `interrupted`. */
export function benchTools(onMemo: () => void): Plugin<"core"> {
  throw new Error("not implemented");
}
