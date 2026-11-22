import { posix } from "node:path";
import { definePart } from "@nyte-ai/core";
import type { ExecutionEnv, Session, SettingDefinition, ToolDefinition, When } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Infer, PartId, ToolContent } from "@nyte-ai/schema";
import type { Command, HookHandler, Plugin } from "@nyte-ai/plugin/core";
import { Type } from "typebox";
import {
  describeStanding,
  DIRECTIONS,
  LOG_PATH,
  parseLog,
  standing,
  standingState,
  STATUSES,
} from "./log.ts";
import type { LogEntry, Standing } from "./log.ts";

const AUTORESEARCH = "autoresearch";

const PROMPT_PATH = ".auto/prompt.md";

const MEASURE = "bash .auto/measure.sh";

const CHECKS_PATH = ".auto/checks.sh";

const OUTSIDE_AUTO = ":(exclude).auto";

const MEASURE_TIMEOUT_S = 600;

const CHECKS_TIMEOUT_S = 300;

const GIT_TIMEOUT_MS = 60_000;

const OUTPUT_TAIL = 4000;

const METRIC_LINE = /^METRIC\s+([^\s=]+)=(\S+)\s*$/u;

const mode = {
  id: AUTORESEARCH,
  title: "Autoresearch",
  description:
    "Runs an experiment loop in this chat: try an idea, measure it, keep or revert it, and repeat until you stop it.",
  type: "switch",
  scope: "chat",
  mode: { icon: "test-tube", color: "oklch(0.62 0.15 160)" },
} satisfies SettingDefinition;

const on: When = (chat) => chat.settings[AUTORESEARCH] === true;

const dashboard = definePart({
  kind: AUTORESEARCH,
  state: standingState,
  actions: {},
  view: new URL("./dashboard.view.tsx", import.meta.url),
  fallback: (current) => describeStanding(current),
});

const LOOP = `Autoresearch mode is on in this chat. Run the experiment loop until the user stops it:

1. Pick one idea from ${PROMPT_PATH} and change the code for it.
2. Call run_experiment. It runs .auto/measure.sh, or the command you pass, times it, reads its \`METRIC name=number\` lines, and runs ${CHECKS_PATH} when the benchmark passes.
3. Call log_experiment with the primary metric and a one-line description. \`keep\` commits the change. \`discard\`, \`crash\` and \`checks_failed\` revert everything outside .auto/. Never keep a run whose checks failed.
4. Add what you learned to ${PROMPT_PATH}: what worked, what didn't, and ideas still untried. A fresh agent must be able to continue from that file and ${LOG_PATH} alone.
5. Go back to 1. Don't stop to report or ask. When ideas run out, look for new angles in the code and in what failed.

When confidence is under 1x, re-run the best idea before building on it.`;

const SETUP_STEPS = `- Work out the metric, its unit, whether lower or higher is better, the command that measures it, and the files in scope. Infer what you can from the code; ask with the question tool for what you can't.
- From a clean working tree, create a branch for this session, such as autoresearch/<short-name>.
- Write ${PROMPT_PATH} (objective, metric, files in scope, constraints, ideas) and .auto/measure.sh, which prints \`METRIC <name>=<number>\` lines. Add ${CHECKS_PATH} when correctness needs guarding, for example tests and types.
- Call init_experiment, measure the baseline with run_experiment, and log it with log_experiment as keep.`;

const SETUP = `Autoresearch mode is on in this chat, and this workspace has no session yet. Treat the user's next message as the goal and set one up, then start the loop:
${SETUP_STEPS}`;

const CONTINUE = "Continue the autoresearch loop with the next experiment.";

const USAGE = "Name what to optimize, for example /autoresearch make the test suite faster.";

const DIRTY =
  "The working tree has changes outside .auto/. Commit them on this session's branch first, so a discarded experiment reverts only its own changes.";

const NO_SESSION = "This workspace has no autoresearch session. Call init_experiment first.";

const NOT_TEXT = `${LOG_PATH} isn't a text file.`;

const STALE_LOG = `${LOG_PATH} changed while it was being written. Log the run again.`;

const initParameters = standard(
  Type.Object({
    name: Type.String({ minLength: 1, description: "A short name for this session." }),
    metric: Type.String({
      minLength: 1,
      description: "The primary metric, as named in measure.sh's METRIC lines.",
    }),
    unit: Type.String({ description: 'Its unit, such as "s", "ms" or "KB"; "" for none.' }),
    direction: Type.Enum(DIRECTIONS, {
      description: "Whether a lower or a higher value is better.",
    }),
  }),
);

const runParameters = standard(
  Type.Object({
    command: Type.Optional(
      Type.String({ minLength: 1, description: `The command to measure; ${MEASURE} by default.` }),
    ),
    timeout_seconds: Type.Optional(
      Type.Integer({ minimum: 1, description: `${MEASURE_TIMEOUT_S} by default.` }),
    ),
  }),
);

const logParameters = standard(
  Type.Object({
    status: Type.Enum(STATUSES, {
      description: "keep commits the change; the others revert everything outside .auto/.",
    }),
    metric: Type.Union([Type.Number(), Type.Null()], {
      description: "The primary metric from run_experiment, or null when it crashed.",
    }),
    description: Type.String({
      minLength: 1,
      description: "What this experiment changed, in one line.",
    }),
    notes: Type.Optional(
      Type.String({ description: "What you expected and what you learned, for later runs." }),
    ),
  }),
);

const initExperiment: ToolDefinition<Infer<typeof initParameters>> = {
  name: "init_experiment",
  when: on,
  description:
    "Start an autoresearch session: name its primary metric and direction. Needs a clean working tree outside .auto/, since discarded experiments are reverted with git. Call it again to start a new segment with a different metric.",
  parameters: initParameters,
  class: (args) => ({ kind: "custom", label: `Starting autoresearch: ${args.name}` }),
  rerun: "never",
  async execute(args, invocation) {
    const changed = await git(
      invocation.env,
      ["status", "--porcelain", "--", ".", OUTSIDE_AUTO],
      invocation.signal,
    );

    if (changed.trim() !== "") throw new Error(DIRTY);

    const config: LogEntry = { type: "config", ...args };
    const entries = await readLog(invocation.env);

    await appendLog(invocation.env, config);

    const current = standing([...entries, config]);
    const shown = current === null ? [] : await showStanding(invocation.session, current);

    return {
      ...reply(
        `Started "${args.name}": ${args.metric}, ${args.direction} is better. Measure the baseline next and log it as keep.`,
      ),
      parts: shown,
    };
  },
};

const runExperiment: ToolDefinition<Infer<typeof runParameters>> = {
  name: "run_experiment",
  when: on,
  description: `Run the benchmark and time it: ${MEASURE} unless you pass a command. Reports its exit code, wall-clock time, its \`METRIC name=number\` lines and the end of its output. When it exits 0 and ${CHECKS_PATH} exists, runs that too and reports whether it passed.`,
  parameters: runParameters,
  class: (args) => ({ kind: "shell", command: args.command ?? MEASURE }),
  rerun: "never",
  async execute(args, invocation) {
    const env = invocation.env;
    const command = args.command ?? MEASURE;
    const started = performance.now();

    const measured = await collect(
      env,
      ["/bin/sh", "-c", command],
      (args.timeout_seconds ?? MEASURE_TIMEOUT_S) * 1000,
      invocation.signal,
      (latest) => invocation.progress({ text: latest }),
    );

    const seconds = (performance.now() - started) / 1000;
    const metrics = measured.output.split(/\r?\n/u).flatMap((line) => metricLine(line.trim()));

    const lines = [
      measured.timedOut
        ? `Stopped after ${args.timeout_seconds ?? MEASURE_TIMEOUT_S} s.`
        : `Exit code ${measured.code ?? "none"} after ${seconds.toFixed(1)} s.`,
      ...(metrics.length === 0
        ? ["No METRIC lines."]
        : metrics.map((metric) => `METRIC ${metric.name}=${metric.value}`)),
    ];

    const checks =
      measured.code === 0 && (await env.files.stat(posix.join(env.cwd, CHECKS_PATH))) !== null
        ? await collect(env, ["bash", CHECKS_PATH], CHECKS_TIMEOUT_S * 1000, invocation.signal)
        : null;

    const verdict =
      checks === null
        ? []
        : checks.code === 0
          ? ["Checks passed."]
          : [`Checks failed with exit code ${checks.code ?? "none"}:`, tail(checks.output)];

    return reply([...lines, ...verdict, "", tail(measured.output)].join("\n"));
  },
};

const logExperiment: ToolDefinition<Infer<typeof logParameters>> = {
  name: "log_experiment",
  when: on,
  description: `Record a run in ${LOG_PATH}. keep commits everything outside .auto/; discard, crash and checks_failed revert it. Returns the session's best result against its baseline and how far above the noise it sits.`,
  parameters: logParameters,
  class: (args) => ({ kind: "custom", label: `Logging experiment: ${args.status}` }),
  rerun: "never",
  async execute(args, invocation) {
    const env = invocation.env;
    const entries = await readLog(env);
    const current = standing(entries);

    if (current === null) throw new Error(NO_SESSION);

    const commit =
      args.status === "keep"
        ? await commitRun(
            env,
            args.description,
            `autoresearch run ${current.next} (${current.config.name})`,
            invocation.signal,
          )
        : await revertRun(env, invocation.signal);

    const entry: LogEntry = {
      type: "run",
      run: current.next,
      status: args.status,
      metric: args.metric,
      description: args.description,
      commit,
      notes: args.notes ?? null,
    };

    await appendLog(env, entry);

    const after = standing([...entries, entry]);
    const shown = after === null ? [] : await showStanding(invocation.session, after);

    const verb =
      args.status === "keep"
        ? `kept${commit === null ? " with no changes" : ` as ${commit.slice(0, 7)}`}`
        : "reverted";

    return {
      ...reply(`Run ${current.next} ${verb}. ${after === null ? "" : describeStanding(after)}`),
      parts: shown,
    };
  },
};

const autoresearchCommand: Command<"core"> = {
  name: AUTORESEARCH,
  title: "Autoresearch",
  description: "Run an experiment loop on a goal, or leave it with off",
  takesText: true,
  complete: (prefix) =>
    "off".startsWith(prefix.trim())
      ? [{ value: "off", label: "off", description: "Leave autoresearch mode" }]
      : [],
  async run(text, context) {
    const api = context.api;

    if (text === "off") {
      await api.registries.settings.set(AUTORESEARCH, false);

      return `Autoresearch is off. ${LOG_PATH} is kept, so /autoresearch resumes it.`;
    }

    const resuming = (await api.env.files.stat(posix.join(api.env.cwd, PROMPT_PATH))) !== null;

    if (!resuming && text === "") return USAGE;

    await api.registries.settings.set(AUTORESEARCH, true);

    return { prompt: resuming ? resume(text) : setup(text) };
  },
};

function setup(goal: string): string {
  return `Start an autoresearch session: ${goal}

Set it up, then start the loop:
${SETUP_STEPS}`;
}

function resume(note: string): string {
  const added = note === "" ? "" : `\n\nThe user adds: ${note}`;

  return `Resume the autoresearch session in .auto/. Read ${PROMPT_PATH}, the end of ${LOG_PATH} and \`git log --oneline -20\`, then continue the loop.${added}`;
}

const continueLoop: HookHandler<"run_ended"> = async (end, context) => {
  const api = context.api;

  if (context.head === null || context.run === null) return;

  if ((await api.registries.settings.value(AUTORESEARCH)) !== true) return;

  if (end.kind === "stopped") {
    await api.registries.settings.set(AUTORESEARCH, false);

    return;
  }

  if (end.kind !== "completed" || standing(await readLog(api.env)) === null) return;

  await api.session.head(context.head).send(CONTINUE, {
    delivery: "queue",
    source: { kind: "action", label: "Autoresearch", command: AUTORESEARCH },
    id: asId(`${AUTORESEARCH}-${context.run}`),
  });
};

async function commitRun(
  env: ExecutionEnv,
  subject: string,
  body: string,
  signal: AbortSignal,
): Promise<string | null> {
  await git(env, ["add", "-A", "--", ".", OUTSIDE_AUTO], signal);

  if ((await git(env, ["diff", "--cached", "--name-only"], signal)).trim() === "") return null;

  await git(env, ["commit", "-q", "-m", subject, "-m", body], signal);

  return (await git(env, ["rev-parse", "HEAD"], signal)).trim();
}

async function revertRun(env: ExecutionEnv, signal: AbortSignal): Promise<null> {
  await git(
    env,
    ["restore", "--source=HEAD", "--staged", "--worktree", "--", ".", OUTSIDE_AUTO],
    signal,
  );
  await git(env, ["clean", "-fd", "-e", ".auto", "--", "."], signal);

  return null;
}

async function showStanding(session: Session, current: Standing): Promise<readonly PartId[]> {
  const shown = (await session.view()).messages.findLast(
    (message) => message.kind === "part" && message.partKind === dashboard.kind,
  );

  const updated = shown?.kind === "part" ? await session.part(shown.part).update(current) : null;

  if (updated?.kind === "updated") return [];

  const part = await session.parts.create(dashboard, {
    state: current,
    placement: { kind: "transcript", role: "answer" },
  });

  return [part.id];
}

async function readLog(env: ExecutionEnv): Promise<readonly LogEntry[]> {
  const file = await env.files.read(posix.join(env.cwd, LOG_PATH));

  return file.kind === "text" ? parseLog(file.contents) : [];
}

async function appendLog(env: ExecutionEnv, entry: LogEntry): Promise<void> {
  const path = posix.join(env.cwd, LOG_PATH);
  const file = await env.files.read(path);

  if (file.kind !== "text" && file.kind !== "missing") throw new Error(NOT_TEXT);

  const before = file.kind === "text" ? file.contents : "";
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";

  const written = await env.files.write(path, `${before}${separator}${JSON.stringify(entry)}\n`, {
    expect: file.kind === "text" ? file.version : "absent",
    parents: true,
  });

  if (written.kind !== "saved") throw new Error(STALE_LOG);
}

async function git(
  env: ExecutionEnv,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  const result = await collect(env, ["git", ...args], GIT_TIMEOUT_MS, signal);

  if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed: ${result.output.trim()}`);

  return result.stdout;
}

async function collect(
  env: ExecutionEnv,
  argv: readonly string[],
  timeoutMs: number,
  signal: AbortSignal,
  progress?: (latest: string) => void,
): Promise<{
  readonly code: number | null;
  readonly output: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}> {
  const timeout = AbortSignal.timeout(timeoutMs);

  await using job = await env.exec(argv, {
    cwd: env.cwd,
    signal: AbortSignal.any([signal, timeout]),
    stdio: "protocol",
  });

  const decoder = new TextDecoder();
  let output = "";
  let stdout = "";
  let code: number | null = null;

  for await (const frame of job.output()) {
    if (frame.kind === "exit") {
      code = frame.code;

      break;
    }

    if (frame.kind !== "bytes") continue;
    const chunk = decoder.decode(frame.data, { stream: true });
    output += chunk;

    if (frame.stream !== "stderr") stdout += chunk;
    progress?.(tail(output));
  }

  return { code, output, stdout, timedOut: timeout.aborted };
}

function metricLine(line: string): readonly { readonly name: string; readonly value: number }[] {
  const match = METRIC_LINE.exec(line);
  const value = Number(match?.[2]);

  return match?.[1] === undefined || !Number.isFinite(value) ? [] : [{ name: match[1], value }];
}

function tail(output: string): string {
  return output.length <= OUTPUT_TAIL
    ? output.trimEnd()
    : `…${output.slice(-OUTPUT_TAIL).trimEnd()}`;
}

function reply(value: string) {
  return { content: [{ kind: "text", text: value } satisfies ToolContent] };
}

export default {
  id: AUTORESEARCH,
  contribute: {
    parts: [dashboard],
    settings: [mode],
    tools: [initExperiment, runExperiment, logExperiment],
    prompt: [
      {
        id: AUTORESEARCH,
        text: async (context) => (standing(await readLog(context.api.env)) === null ? SETUP : LOOP),
        when: on,
      },
    ],
    commands: [autoresearchCommand],
  },
  hooks: { run_ended: continueLoop },
} satisfies Plugin;
