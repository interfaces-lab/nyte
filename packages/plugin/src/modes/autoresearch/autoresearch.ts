import { posix } from "node:path";
import { definePart } from "@nyte-ai/core";
import type { ExecutionEnv, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { FileVersion, Infer, PartId, ToolContent } from "@nyte-ai/schema";
import type { HookHandler } from "@nyte-ai/plugin/core";
import type { Mode } from "../mode.ts";
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

const DASHBOARD_KEY = "dashboard";

const PROMPT_PATH = ".auto/prompt.md";

const MEASURE = "bash .auto/measure.sh";

const CHECKS_PATH = ".auto/checks.sh";

const OUTSIDE_AUTO = ":(exclude).auto";

const PATHS = [".", OUTSIDE_AUTO] as const;

const MEASURE_TIMEOUT_S = 600;

const CHECKS_TIMEOUT_S = 300;

const GIT_TIMEOUT_MS = 60_000;

const OUTPUT_TAIL = 4000;

const MAX_METRIC_LINE = 4096;

const MAX_METRICS = 1000;

const METRIC_LINE = /^METRIC\s+([^\s=]+)=(\S+)\s*$/u;

const MODE = "mode.autoresearch";

const PROMPT = `When ${PROMPT_PATH} doesn't exist yet, treat the user's goal as the objective and set up a session first:

- Work out the metric, its unit, whether lower or higher is better, the command that measures it, and the files in scope. Infer what you can from the code; ask with the question tool for what you can't.
- Write ${PROMPT_PATH} (objective, metric, files in scope, constraints, ideas) and .auto/measure.sh, which prints \`METRIC <name>=<number>\` lines. Add ${CHECKS_PATH} when correctness needs guarding, for example tests and types.
- Call init_experiment, measure the baseline with run_experiment, and log it with log_experiment as keep.

Then run the experiment loop until the user stops it:

1. Pick one idea from ${PROMPT_PATH} and change the code for it.
2. Call run_experiment. It runs .auto/measure.sh, or the command you pass, times it, reads its \`METRIC name=number\` lines, and runs ${CHECKS_PATH} when the benchmark passes.
3. Call log_experiment with the primary metric and a one-line description. \`keep\` commits the change. \`discard\`, \`crash\` and \`checks_failed\` revert everything outside .auto/. Never keep a run whose checks failed.
4. Add what you learned to ${PROMPT_PATH}: what worked, what didn't, and ideas still untried. A fresh agent must be able to continue from that file and ${LOG_PATH} alone.
5. Go back to 1. Don't stop to report or ask. When ideas run out, look for new angles in the code and in what failed.

When confidence is under 1x, re-run the best idea before building on it.`;

const dashboard = definePart({
  kind: AUTORESEARCH,
  state: standingState,
  actions: {},
  view: new URL("./dashboard.view.tsx", import.meta.url),
  fallback: (current) => describeStanding(current),
});

const CONTINUE = "Continue the autoresearch loop with the next experiment.";

const DIRTY =
  "The working tree has changes outside .auto/. Commit them first, so a discarded experiment reverts only its own changes.";

const DETACHED_HEAD =
  "HEAD is detached. Check out this chat's branch again, then call init_experiment.";

const OUTSIDE_WORKTREE =
  "Autoresearch commits and reverts code, so it runs only in a chat with its own worktree. Start the chat in a worktree, then turn Autoresearch on.";

const NO_SESSION = "This workspace has no autoresearch session. Call init_experiment first.";

const NOT_TEXT = `${LOG_PATH} isn't a text file.`;

const STALE_LOG = `${LOG_PATH} changed while it was being written. Log the run again.`;

const storedPartId = standard(Type.String({ minLength: 1 }));

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
  description:
    "Start an autoresearch session: name its primary metric and direction. Needs a clean working tree outside .auto/, since discarded experiments are reverted with git. Call it again to start a new segment with a different metric.",
  parameters: initParameters,
  class: (args) => ({ kind: "custom", label: `Starting autoresearch: ${args.name}` }),
  rerun: "never",
  async execute(args, invocation) {
    await requireOwnWorktree(invocation);
    const env = invocation.env;
    const changed = await git(env, ["status", "--porcelain", "--", ...PATHS], invocation.signal);

    if (changed.trim() !== "") throw new Error(DIRTY);

    const branch = (await git(env, ["branch", "--show-current"], invocation.signal)).trim();

    if (branch === "") throw new Error(DETACHED_HEAD);

    const commit = (await git(env, ["rev-parse", "--verify", "HEAD"], invocation.signal)).trim();
    const snapshot = await readLogSnapshot(env);
    const config: LogEntry = { type: "config", ...args, branch, commit };

    await appendLog(env, snapshot, config);

    const current = standing([...snapshot.entries, config]);
    const shown = current === null ? [] : await showStanding(invocation, current);

    return {
      ...reply(
        `Started "${args.name}" on branch "${branch}" at ${commit.slice(0, 7)}: ${args.metric}, ${args.direction} is better. Measure the baseline next and log it as keep.`,
      ),
      parts: shown,
    };
  },
};

const runExperiment: ToolDefinition<Infer<typeof runParameters>> = {
  name: "run_experiment",
  description: `Run the benchmark and time it: ${MEASURE} unless you pass a command. Reports its exit code, wall-clock time, its \`METRIC name=number\` lines and the end of its output. When it exits 0 and ${CHECKS_PATH} exists, runs that too and reports whether it passed.`,
  parameters: runParameters,
  class: (args) => ({ kind: "shell", command: args.command ?? MEASURE }),
  rerun: "never",
  async execute(args, invocation) {
    await requireOwnWorktree(invocation);
    const env = invocation.env;
    const command = args.command ?? MEASURE;
    const started = performance.now();
    const metrics: { readonly name: string; readonly value: number }[] = [];

    const measured = await collect(
      env,
      ["/bin/sh", "-c", command],
      (args.timeout_seconds ?? MEASURE_TIMEOUT_S) * 1000,
      invocation.signal,
      {
        progress: (latest) => invocation.progress({ text: latest }),
        onLine: (line) => {
          const parsed = parseMetricLine(line.trim());

          if (parsed === null) return;

          if (metrics.length >= MAX_METRICS) metrics.shift();
          metrics.push(parsed);
        },
      },
    );

    const seconds = (performance.now() - started) / 1000;

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
          : [`Checks failed with exit code ${checks.code ?? "none"}:`, checks.tail];

    return reply([...lines, ...verdict, "", measured.tail].join("\n"));
  },
};

const logExperiment: ToolDefinition<Infer<typeof logParameters>> = {
  name: "log_experiment",
  description: `Record a run in ${LOG_PATH}. keep commits everything outside .auto/; discard, crash and checks_failed revert it. Returns the session's best result against its baseline and how far above the noise it sits.`,
  parameters: logParameters,
  class: (args) => ({ kind: "custom", label: `Logging experiment: ${args.status}` }),
  rerun: "never",
  async execute(args, invocation) {
    await requireOwnWorktree(invocation);
    const env = invocation.env;
    const snapshot = await readLogSnapshot(env);
    const current = standing(snapshot.entries);

    if (current === null) throw new Error(NO_SESSION);

    const commit = await applyRunGit(env, current, args, invocation.signal);

    const entry: LogEntry = {
      type: "run",
      run: current.next,
      status: args.status,
      metric: args.metric,
      description: args.description,
      commit,
      notes: args.notes ?? null,
    };

    await appendLog(env, snapshot, entry);

    const after = standing([...snapshot.entries, entry]);
    const shown = after === null ? [] : await showStanding(invocation, after);

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

async function requireOwnWorktree(invocation: ToolInvocation): Promise<void> {
  if ((await invocation.workspace.info()).isolation?.session !== invocation.session.id) {
    throw new Error(OUTSIDE_WORKTREE);
  }
}

const continueLoop: HookHandler<"run_ended"> = async (end, context) => {
  const api = context.api;

  if (context.head === null || context.run === null) return;

  if ((await api.registries.settings.value(MODE)) !== true) return;

  if (end.kind === "stopped") {
    await api.registries.settings.set(MODE, false);

    return;
  }

  if (end.kind !== "completed" || standing(await readLog(api.env)) === null) return;

  if ((await api.registries.settings.value(MODE)) !== true) return;

  await api.session.head(context.head).send(CONTINUE, {
    delivery: "queue",
    source: { kind: "action", label: "Autoresearch" },
    id: asId(`${AUTORESEARCH}-${context.run}`),
  });
};

interface LogSnapshot {
  readonly entries: readonly LogEntry[];
  readonly contents: string;
  readonly expect: FileVersion | "absent";
}

interface CollectOptions {
  readonly progress?: (latest: string) => void;
  readonly onLine?: (line: string) => void;
  readonly captureStdout?: boolean;
}

async function applyRunGit(
  env: ExecutionEnv,
  current: Standing,
  args: Infer<typeof logParameters>,
  signal: AbortSignal,
): Promise<string | null> {
  const branch = (await git(env, ["branch", "--show-current"], signal)).trim();

  if (branch !== current.config.branch) {
    const found = branch === "" ? "a detached HEAD" : `branch "${branch}"`;

    throw new Error(
      `Refused to log run ${current.next}: checked out on ${found}, expected branch "${current.config.branch}".`,
    );
  }

  const head = (await git(env, ["rev-parse", "--verify", "HEAD"], signal)).trim();

  const expectedCommit =
    current.runs.findLast((run) => run.status === "keep" && run.commit !== null)?.commit ??
    current.config.commit;

  const runBody = `autoresearch run ${current.next} (${current.config.name})`;

  if (head !== expectedCommit) {
    const parents = (await git(env, ["show", "-s", "--format=%P", head], signal)).trim();
    const body = (await git(env, ["show", "-s", "--format=%b", head], signal)).trim();

    if (parents === expectedCommit && body === runBody) {
      if (args.status !== "keep") {
        throw new Error(
          `Refused to log run ${current.next} as ${args.status}: HEAD is already at unlogged keep commit ${head.slice(0, 7)} (${runBody}).`,
        );
      }

      return head;
    }

    throw new Error(
      `Refused to log run ${current.next}: HEAD is ${head.slice(0, 7)}, expected ${expectedCommit.slice(0, 7)}.`,
    );
  }

  return args.status === "keep"
    ? commitRun(env, args.description, runBody, signal)
    : revertRun(env, signal);
}

async function commitRun(
  env: ExecutionEnv,
  subject: string,
  body: string,
  signal: AbortSignal,
): Promise<string | null> {
  await git(env, ["add", "-A", "--", ...PATHS], signal);

  if ((await git(env, ["diff", "--cached", "--name-only", "--", ...PATHS], signal)).trim() === "") {
    return null;
  }

  await git(env, ["commit", "-q", "-m", subject, "-m", body, "--", ...PATHS], signal);

  return (await git(env, ["rev-parse", "HEAD"], signal)).trim();
}

async function revertRun(env: ExecutionEnv, signal: AbortSignal): Promise<null> {
  await git(env, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...PATHS], signal);
  await git(env, ["clean", "-fd", "-e", ".auto", "--", "."], signal);

  return null;
}

async function showStanding(
  invocation: ToolInvocation,
  current: Standing,
): Promise<readonly PartId[]> {
  const storage = invocation.api.storage.at("session");
  const checked = storedPartId["~standard"].validate(await storage.get(DASHBOARD_KEY));

  const saved =
    checked instanceof Promise || checked.issues !== undefined ? null : asId<"part">(checked.value);

  if (saved !== null) {
    const updated = await invocation.session.part(saved).update(current);

    if (updated.kind === "updated") return [];
  }

  const part = await invocation.session.parts.create(dashboard, {
    state: current,
    placement: { kind: "transcript", role: "answer" },
  });

  await storage.set(DASHBOARD_KEY, part.id);

  return [part.id];
}

async function readLog(env: ExecutionEnv): Promise<readonly LogEntry[]> {
  const file = await env.files.read(posix.join(env.cwd, LOG_PATH));

  return file.kind === "text" ? parseLog(file.contents) : [];
}

async function readLogSnapshot(env: ExecutionEnv): Promise<LogSnapshot> {
  const file = await env.files.read(posix.join(env.cwd, LOG_PATH));

  if (file.kind === "text") {
    return { entries: parseLog(file.contents), contents: file.contents, expect: file.version };
  }

  if (file.kind === "missing") return { entries: [], contents: "", expect: "absent" };

  throw new Error(NOT_TEXT);
}

async function appendLog(env: ExecutionEnv, snapshot: LogSnapshot, entry: LogEntry): Promise<void> {
  const separator = snapshot.contents === "" || snapshot.contents.endsWith("\n") ? "" : "\n";

  const written = await env.files.write(
    posix.join(env.cwd, LOG_PATH),
    `${snapshot.contents}${separator}${JSON.stringify(entry)}\n`,
    { expect: snapshot.expect, parents: true },
  );

  if (written.kind !== "saved") throw new Error(STALE_LOG);
}

async function git(
  env: ExecutionEnv,
  args: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  const result = await collect(env, ["git", ...args], GIT_TIMEOUT_MS, signal, {
    captureStdout: true,
  });

  if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed: ${result.tail.trim()}`);

  return result.stdout;
}

async function collect(
  env: ExecutionEnv,
  argv: readonly string[],
  timeoutMs: number,
  signal: AbortSignal,
  options: CollectOptions = {},
): Promise<{
  readonly code: number | null;
  readonly tail: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}> {
  const timeout = AbortSignal.timeout(timeoutMs);

  await using job = await env.exec(argv, {
    cwd: env.cwd,
    signal: AbortSignal.any([signal, timeout]),
    stdio: "protocol",
  });

  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const stdoutLines = options.onLine === undefined ? null : createLineScanner(options.onLine);
  const stderrLines = options.onLine === undefined ? null : createLineScanner(options.onLine);
  let tailText = "";
  let truncated = false;
  let stdout = "";
  let code: number | null = null;

  const consume = (chunk: string, isStderr: boolean): void => {
    if (chunk === "") return;

    if (tailText.length + chunk.length > OUTPUT_TAIL) {
      truncated = true;
      tailText =
        chunk.length >= OUTPUT_TAIL
          ? chunk.slice(-OUTPUT_TAIL)
          : `${tailText.slice(-(OUTPUT_TAIL - chunk.length))}${chunk}`;
    } else {
      tailText += chunk;
    }

    if (options.captureStdout === true && !isStderr) stdout += chunk;
    (isStderr ? stderrLines : stdoutLines)?.push(chunk);
    options.progress?.(formatTail(tailText, truncated));
  };

  for await (const frame of job.output()) {
    if (frame.kind === "exit") {
      code = frame.code;

      break;
    }

    if (frame.kind === "gap") {
      stdoutLines?.reset();
      stderrLines?.reset();

      continue;
    }

    if (frame.kind !== "bytes") continue;
    const isStderr = frame.stream === "stderr";
    const chunk = (isStderr ? stderrDecoder : stdoutDecoder).decode(frame.data, { stream: true });

    consume(chunk, isStderr);
  }

  consume(stdoutDecoder.decode(), false);
  consume(stderrDecoder.decode(), true);
  stdoutLines?.flush();
  stderrLines?.flush();

  return { code, tail: formatTail(tailText, truncated), stdout, timedOut: timeout.aborted };
}

function createLineScanner(onLine: (line: string) => void) {
  let pending = "";
  let overflow = false;

  const emit = (line: string): void => {
    if (line.length <= MAX_METRIC_LINE) onLine(line);
  };

  return {
    push(chunk: string) {
      const parts = chunk.split("\n");

      if (parts.length === 1) {
        const piece = parts[0] ?? "";

        if (overflow) return;

        if (pending.length + piece.length > MAX_METRIC_LINE) {
          pending = "";
          overflow = true;

          return;
        }

        pending += piece;

        return;
      }

      const first = parts[0] ?? "";

      if (!overflow && pending.length + first.length <= MAX_METRIC_LINE) {
        emit(`${pending}${first}`);
      }

      for (const middle of parts.slice(1, -1)) emit(middle);

      const last = parts.at(-1) ?? "";

      if (last.length > MAX_METRIC_LINE) {
        pending = "";
        overflow = true;

        return;
      }

      pending = last;
      overflow = false;
    },
    flush() {
      if (!overflow && pending !== "") emit(pending);
      pending = "";
      overflow = false;
    },
    reset() {
      pending = "";
      overflow = false;
    },
  };
}

function parseMetricLine(line: string): { readonly name: string; readonly value: number } | null {
  const match = METRIC_LINE.exec(line);
  const value = Number(match?.[2]);

  return match?.[1] === undefined || !Number.isFinite(value) ? null : { name: match[1], value };
}

function formatTail(output: string, truncated: boolean): string {
  return truncated ? `…${output.trimEnd()}` : output.trimEnd();
}

function reply(value: string) {
  return { content: [{ kind: "text", text: value } satisfies ToolContent] };
}

export default {
  id: MODE,
  title: "Autoresearch",
  description:
    "Runs an experiment loop in this chat: try an idea, measure it, keep or revert it, and repeat until you stop it.",
  icon: "atom",
  color: "oklch(0.62 0.15 160)",
  prompt: PROMPT,
  tools: [initExperiment, runExperiment, logExperiment],
  parts: [dashboard],
  onRunEnded: continueLoop,
} satisfies Mode;
