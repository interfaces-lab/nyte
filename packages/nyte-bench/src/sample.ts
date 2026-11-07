import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import type { Provider } from "@nyte-ai/ai/models";
import { fakeModels, readSpanFile, scenarioHome, simulate } from "@nyte-ai/bench";
import { isPart, text, tool } from "@nyte-ai/core";
import type { Host } from "@nyte-ai/core";
import type { ModelRef, SessionId, SessionView, ToolPartState } from "@nyte-ai/schema";
import { getCurrentTools } from "@nyte-ai/schema/model";
import type { TranscriptContext } from "@nyte-ai/schema/model";
import type { ModelsFactory } from "./models.ts";
import type { BenchCase, CaseKind } from "./case.ts";
import { grade } from "./grade.ts";
import type { Call, Check, Trace } from "./grade.ts";

const POLL_MS = 1000;

export interface Job {
  readonly suite: string;
  readonly model: ModelRef;
  readonly case: BenchCase;
  readonly sample: number;
}

/** One sample's result, as a line of `results.jsonl`. */
export interface Row {
  readonly suite: string;
  readonly model: string;
  readonly case: string;
  readonly kind: CaseKind;
  readonly sample: number;
  /** Null when the sample errored before it could be graded. */
  readonly pass: boolean | null;
  readonly timedOut: boolean;
  readonly checks: readonly Check[];
  readonly trace: Trace | null;
  readonly cost: number;
  readonly ms: number;
  readonly error: string | null;
}

interface Member {
  readonly id: SessionId;
  readonly by: Call["by"];
  readonly view: SessionView;
}

/**
 * Runs one case on a fresh host from this checkout, on a temp store, home and workspace,
 * waits for the chat and its subagents to settle and grades what they did. A chat run that
 * fails, such as on a provider error, rejects instead of grading, so it counts against no model.
 */
export async function runSample(
  job: Job,
  openModels: ModelsFactory,
  timeoutMs: number,
): Promise<Row> {
  const started = performance.now();
  await using home = await scenarioHome({ servers: job.case.servers, skills: {} });
  const counted = probeRequests(job.case.subagentReply);
  const models = await openModels(counted.wrap);
  await using simulation = await simulate({ models, home: home.home });

  for (const [name, body] of Object.entries(job.case.files))
    await writeFile(join(simulation.workspace, name), body);
  commitWorkspace(simulation.workspace);
  const host = simulation.host;

  const start = await host.sessions.start({
    content: job.case.prompt,
    configuration: { model: job.model },
  });

  const limit = (job.case.expect.rounds ?? 1) + 1;

  const settled = await settle(
    host,
    start.session.id,
    Date.now() + timeoutMs,
    () => counted.requests() > limit,
  );

  const spans = await readSpanFile(home.traceFile);

  const trace: Trace = {
    calls: settled.members.flatMap((member) =>
      member.view.messages.flatMap((message) =>
        isPart(message, tool) ? [readCall(member.by, message.state)] : [],
      ),
    ),
    requests: counted.requests(),
    subagents: counted.subagents(),
    served: spans.flatMap((span) =>
      span.name === "mcp.serve"
        ? [`${String(span.detail.server)}/${String(span.detail.tool)}`]
        : [],
    ),
    answer: settled.members[0] === undefined ? "" : lastText(settled.members[0].view),
  };

  const checks = grade(job.case.expect, trace);
  const execution = settled.members[0]?.view.execution;
  const end = execution?.kind === "idle" ? execution.lastRun?.end : undefined;

  if (end?.kind === "failed") throw new Error(`The chat's run failed: ${end.failure.message}`);

  return {
    suite: job.suite,
    model: `${job.model.provider}/${job.model.id}`,
    case: job.case.id,
    kind: job.case.kind,
    sample: job.sample,
    pass: !settled.timedOut && checks.every((check) => check.pass),
    timedOut: settled.timedOut,
    checks,
    trace,
    cost: await counted.cost(),
    ms: Math.round(performance.now() - started),
    error: null,
  };
}

/** Waits until the chat, its subagents and the reports they send back have all gone quiet. Stops them at the deadline, or once `over` says the chat took more rounds than the case allows. */
async function settle(
  host: Host,
  root: SessionId,
  deadline: number,
  over: () => boolean,
): Promise<{ readonly timedOut: boolean; readonly members: readonly Member[] }> {
  let quiet = 0;

  while (Date.now() < deadline) {
    const members = await readFamily(host, root);

    if (over()) {
      for (const member of members) await host.session(member.id).stop();

      return { timedOut: false, members: await readFamily(host, root) };
    }

    const idle = members.every(
      (member) =>
        member.view.turns.length > 0 &&
        member.view.execution.kind === "idle" &&
        member.view.queue.length === 0 &&
        !member.view.background.some(
          (item) => item.state === "working" || item.state === "waiting",
        ),
    );

    quiet = idle ? quiet + 1 : 0;

    if (quiet >= 2) return { timedOut: false, members };
    await sleep(POLL_MS);
  }

  for (const member of await readFamily(host, root)) await host.session(member.id).stop();

  return { timedOut: true, members: await readFamily(host, root) };
}

async function readFamily(host: Host, root: SessionId): Promise<readonly Member[]> {
  const children = await host.sessions.list({ parents: { kind: "children", session: root } });

  return Promise.all(
    [
      { id: root, by: "chat" as const },
      ...children.items.map((info) => ({ id: info.id, by: "subagent" as const })),
    ].map(async (entry) => ({ ...entry, view: await host.session(entry.id).view() })),
  );
}

/** Makes the workspace a git repository with its files in one commit, as a project's folder usually is, so worktree isolation works there. */
function commitWorkspace(folder: string): void {
  const git = (...args: readonly string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Nyte Bench", "-c", "user.email=bench@nyte.invalid", ...args],
      { cwd: folder, stdio: "ignore" },
    );

  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "Workspace");
}

/**
 * Wraps each provider of a sample's models to watch its requests. It counts the chat's
 * first-turn requests: those that offer `task`, which only a top-level chat is given, and hold
 * one user message, the prompt, so a subagent's report back to the chat doesn't count. It
 * records the model of every subagent request, one that offers tools but not `task`, and with
 * `subagentReply` answers those requests with it instead of reaching the model. It adds up what
 * every request that reached a model cost, including requests of runs the bench stopped, whose
 * usage the session view leaves out.
 */
function probeRequests(subagentReply: string | undefined) {
  let requests = 0;
  const subagents: string[] = [];
  const costs: Promise<number>[] = [];

  const scripted = fakeModels({
    fallback: { content: [{ type: "text", text: subagentReply ?? "" }] },
  }).provider;

  const route = (
    provider: string,
    model: { readonly id: string },
    context: TranscriptContext,
    reach: () => AssistantMessageEventStream,
    script: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const tools = getCurrentTools(context.messages);
    const chat = tools.some((entry) => entry.name === "task");
    const users = context.messages.filter((message) => message.role === "user").length;

    if (chat && users === 1) requests += 1;
    const subagent = !chat && tools.length > 0;

    if (subagent) subagents.push(`${provider}/${model.id}`);

    if (subagent && subagentReply !== undefined) return script();
    const stream = reach();

    costs.push(
      stream.result().then(
        (message) => message.usage.cost.total,
        () => 0,
      ),
    );

    return stream;
  };

  const wrap = (inner: Provider): Provider => ({
    ...inner,
    stream(model, context, options) {
      return route(
        inner.id,
        model,
        context,
        () => inner.stream(model, context, options),
        () => scripted.streamSimple(model, context),
      );
    },
    streamSimple(model, context, options) {
      return route(
        inner.id,
        model,
        context,
        () => inner.streamSimple(model, context, options),
        () => scripted.streamSimple(model, context, options),
      );
    },
  });

  return {
    wrap,
    requests: () => requests,
    subagents: () => [...subagents],
    cost: async () => (await Promise.all(costs)).reduce((sum, cost) => sum + cost, 0),
  };
}

function readCall(by: Call["by"], state: ToolPartState): Call {
  if (state.phase !== "settled")
    return { by, tool: state.name, args: state.args, outcome: "unsettled", message: null };
  const outcome = state.outcome;

  const message =
    outcome.kind === "failed"
      ? outcome.message
      : outcome.kind === "rejected"
        ? outcome.reason
        : null;

  return { by, tool: state.name, args: state.args, outcome: outcome.kind, message };
}

function lastText(view: SessionView): string {
  return (
    view.messages
      .flatMap((message) => (isPart(message, text) ? [message.state.markdown] : []))
      .findLast((markdown) => markdown !== "") ?? ""
  );
}
