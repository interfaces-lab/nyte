import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { definePart } from "@nyte-ai/core";
import type { Plugin, ToolDefinition } from "@nyte-ai/core";

const NEVER_MS = 60_000;

/** The bench's seeded message: a transcript note holding markdown, with no actions, what `seedSessions` creates. */
export const benchMessage = definePart({
  kind: "bench/message",
  state: standard(Type.Object({ markdown: Type.String() })),
  actions: {},
  fallback: (state, { id }) => `${state.markdown} [${id}]`,
});

/** Returns the core plugin `bench` with the two bench tools. `bench_wait_job` (input `{ command: string }`, replay `safe`): memoises a value under `bench-memo` whose compute calls `onMemo()` (the `bench_memo_runs` counter, so a replay that recomputes shows), memoises the start of `command` as a job in the session's workspace (`jobs.start`), waits on it with `wait({ kind: "job", job })`, and settles ok with the job's end, `lost` included, so a re-run after a restart replays both memos and waits on the job it started. `bench_never` (input `{}`, replay `never`): sleeps 60 s under the call's signal, so a crash finds it running and the restart settles it `interrupted`. */
export function benchTools(onMemo: () => void): Plugin<"core"> {
  const waitJob: ToolDefinition<{ readonly command: string }> = {
    name: "bench_wait_job",
    description: "Start a command as a job and wait for it to end.",
    parameters: standard(Type.Object({ command: Type.String() })),
    class: () => ({ kind: "custom", label: "Waiting on a job" }),
    replay: "safe",
    async execute(args, invocation) {
      await invocation.memo("bench-memo", () => {
        onMemo();

        return true;
      });

      const job = await invocation.memo("bench-job", async () => {
        const started = await invocation.workspace.jobs.start({
          command: args.command,
          session: invocation.session.id,
          title: "bench",
        });

        return started.id;
      });

      const outcome = await invocation.wait({ kind: "job", job });
      const end = outcome.kind === "job" ? outcome.end.kind : outcome.kind;

      return { content: [{ kind: "text", text: `The job ended: ${end}.` }] };
    },
  };

  const never: ToolDefinition<object> = {
    name: "bench_never",
    description: "Sleep for a minute; never replayed.",
    parameters: standard(Type.Object({})),
    class: () => ({ kind: "custom", label: "Sleeping" }),
    replay: "never",
    async execute(_args, invocation) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, NEVER_MS);

        invocation.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(invocation.signal.reason);
          },
          { once: true },
        );
      });

      return { content: [{ kind: "text", text: "Slept." }] };
    },
  };

  return { id: "bench", contribute: { tools: [waitJob, never], parts: [benchMessage] } };
}
