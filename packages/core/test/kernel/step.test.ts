/**
 * One durable step at a time, asserted by what the refs and objects say
 * afterwards. The turn is a script; the store is real.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { AssistantMessage, Message } from "@nyte-ai/schema";
import type { Landing } from "@nyte-ai/protocol";
import { contextMessages } from "@nyte-ai/client";
import {
  listEffects,
  openEffect,
  parkEffect,
  settleEffect,
  signalEffect,
} from "../../src/kernel/effects.ts";
import { branch } from "../../src/kernel/graph.ts";
import type { CommitBody, Run } from "../../src/kernel/model.ts";
import { DELETED_REF, headRef, queueBaseRef, runRef } from "../../src/kernel/names.ts";
import { pending, pendingIn, submit } from "../../src/kernel/queue.ts";
import { moveHead } from "../../src/kernel/stacks.ts";
import { waitForHead } from "../../src/kernel/sdk/wait.ts";
import { drive, step, type StepOptions } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import type { RespondOutcome, ToolBatchOutcome, Turn, TurnInput } from "../../src/kernel/turn.ts";
import {
  assistant,
  call,
  granted,
  landing,
  message,
  openSession,
  openStore,
  seedHead,
  setHead,
  sleep,
  storePath,
  toolResult,
  user,
} from "./helpers.ts";

type ToolsInput = TurnInput & { readonly assistant: AssistantMessage };
type RespondHandler = (input: TurnInput) => Promise<RespondOutcome>;
type ToolsHandler = (input: ToolsInput) => Promise<ToolBatchOutcome>;
type RespondStep = RespondOutcome | RespondHandler;
type ToolsStep = ToolBatchOutcome | ToolsHandler;

function isRespondHandler(step: RespondStep): step is RespondHandler {
  return typeof step === "function";
}

function isToolsHandler(step: ToolsStep): step is ToolsHandler {
  return typeof step === "function";
}

/** Scripted outcomes drive durable state transitions. */
class Script implements Turn {
  private readonly respondSteps: RespondStep[];
  private readonly toolsSteps: ToolsStep[];
  constructor(respondSteps: RespondStep[] = [], toolsSteps: ToolsStep[] = []) {
    this.respondSteps = respondSteps;
    this.toolsSteps = toolsSteps;
  }
  async respond(input: TurnInput): Promise<RespondOutcome> {
    const next = this.respondSteps.shift();
    if (next === undefined) assert.fail("respond was called without a scripted answer");
    return isRespondHandler(next) ? next(input) : next;
  }
  async tools(input: ToolsInput): Promise<ToolBatchOutcome> {
    const next = this.toolsSteps.shift();
    if (next === undefined) assert.fail("tools was called without a scripted answer");
    return isToolsHandler(next) ? next(input) : next;
  }
}

const say = (text: string) => message(user(text));
const complete = (text: string): RespondOutcome => ({ kind: "complete", message: assistant(text) });
const asks = (...ids: string[]): RespondOutcome => ({
  kind: "tools",
  message: assistant("", { calls: ids.map((id) => call(id, "read", { id })) }),
  calls: Object.fromEntries(ids.map((id) => [id, { kind: "file_read", path: id }])),
});
const results = (...ids: string[]): ToolBatchOutcome => ({
  kind: "complete",
  messages: ids.map((id) => toolResult(id, "read", `out ${id}`)),
  calls: {},
});

async function currentRun(session: Session): Promise<Run | undefined> {
  const oid = await session.refs.read(runRef("main"));
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  return object?.kind === "run" ? object : undefined;
}

/** The branch as a list of what each commit holds: message roles and marker kinds. */
async function branchBodyRoles(session: Session): Promise<string[]> {
  const tip = await session.refs.read(headRef("main"));
  return (await branch(session.objects, tip)).map(({ commit }) =>
    commit.body.kind === "message" ? commit.body.message.role : commit.body.kind,
  );
}

async function textAt(session: Session, index: number): Promise<string> {
  const tip = await session.refs.read(headRef("main"));
  const body = (await branch(session.objects, tip))[index]?.commit.body;
  const content: Message["content"] | undefined =
    body?.kind === "message" ? body.message.content : undefined;
  if (content === undefined) return "";
  if (!Array.isArray(content)) return content;
  const first = content?.[0];
  return first?.type === "text" ? first.text : "";
}

async function stepMain(
  session: Session,
  turn: Turn,
  options: Partial<Omit<StepOptions, "head" | "landing">> = {},
): Promise<ReturnType<typeof step>> {
  return step(session, turn, { head: "main", landing, ...options });
}

test("a submitted message lands, gets its answer, and the head goes idle", async () => {
  const session = await openSession();
  const turn = new Script([complete("hello back")]);
  const sent = await submit(session, { head: "main", lane: "now", body: say("hello") });

  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), ["user"]);
  assert.equal(await session.refs.read(queueBaseRef("main", "now")), sent.change);
  assert.equal((await currentRun(session))?.phase.kind, "respond");
  assert.deepEqual(await pending(session, "main"), []);

  const answered = await stepMain(session, turn);
  assert.equal(answered.kind, "finished");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
  assert.equal(await textAt(session, 1), "hello back");
  const run = await currentRun(session);
  assert.equal(run?.phase.kind, "done");
  assert.equal(run?.attempts, 1);

  assert.equal((await stepMain(session, turn)).kind, "idle");
});

test("a tool round commits the call, then every result in order, then the answer", async () => {
  const session = await openSession();
  const turn = new Script(
    [asks("c1", "c2"), complete("done")],
    [
      async (input) => {
        for (const callId of ["c1", "c2"]) {
          await openEffect(input.session, {
            lease: input.lease,
            runId: input.run.id,
            callId,
            tool: "read",
            args: { id: callId },
            replay: "never",
          });
        }
        return results("c1", "c2");
      },
    ],
  );
  await submit(session, { head: "main", lane: "now", body: say("read both") });
  await stepMain(session, turn);
  await stepMain(session, turn);
  assert.equal((await currentRun(session))?.phase.kind, "tools");

  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "toolResult",
    "toolResult",
  ]);
  assert.equal(await textAt(session, 2), "out c1");
  assert.equal(await textAt(session, 3), "out c2");
  const run = await currentRun(session);
  assert.equal(run?.phase.kind, "respond");
  assert.deepEqual(await listEffects(session, run?.id ?? ""), []);

  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "toolResult",
    "toolResult",
    "assistant",
  ]);
});

test("an agent switch ends the current run with the next landing batch still queued", async () => {
  const session = await openSession();
  const turn = new Script([asks("c1"), complete("agent B answered")], [results("c1")]);
  await submit(session, {
    head: "main",
    lane: "now",
    body: { kind: "message", message: user("first"), agent: "agent-a" },
  });
  await stepMain(session, turn);
  await stepMain(session, turn);
  await stepMain(session, turn);
  const previous = await currentRun(session);
  assert.ok(previous !== undefined);
  const tip = await session.refs.read(headRef("main"));
  const base = await session.refs.read(queueBaseRef("main", "now"));
  const config = await submit(session, {
    head: "main",
    lane: "now",
    body: { kind: "config", thinkingLevel: "high" },
  });
  const sent = await submit(session, {
    head: "main",
    lane: "now",
    body: { kind: "message", message: user("switch"), agent: "agent-b" },
  });

  const ended = await stepMain(session, turn);
  assert.ok(ended.kind === "finished");
  assert.equal(ended.run.id, previous.id);
  assert.equal(ended.run.phase.kind, "done");
  assert.equal(ended.run.config.agent, "agent-a");
  assert.equal(await session.refs.read(headRef("main")), tip);
  assert.equal(await session.refs.read(queueBaseRef("main", "now")), base);
  assert.deepEqual(
    (await pendingIn(session, { head: "main", lane: "now" })).map((item) => item.oid),
    [config.change, sent.change],
  );

  await stepMain(session, turn);
  const started = await currentRun(session);
  assert.ok(started !== undefined);
  assert.notEqual(started.id, previous.id);
  assert.deepEqual(started.config, { agent: "agent-b", thinkingLevel: "high" });
  assert.equal(started.attempts, 0);
  assert.deepEqual(await pending(session, "main"), []);
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.equal((await currentRun(session))?.id, started.id);
  assert.equal(await textAt(session, 5), "agent B answered");
});

test("input that arrives during a run lands after the current answer; the idle lane waits for the end", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      await submit(input.session, { head: "main", lane: "now", body: say("while streaming") });
      return complete("first answer");
    },
    complete("second answer"),
    complete("third answer"),
    complete("fourth answer"),
  ]);
  await submit(session, { head: "main", lane: "now", body: say("first") });
  await submit(session, { head: "main", body: say("for later"), lane: "later" });
  await stepMain(session, turn);
  await submit(session, { head: "main", lane: "now", body: say("steer me") });

  // "first" is still unanswered, so nothing else lands before its answer.
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
  assert.equal(await textAt(session, 1), "first answer");
  assert.deepEqual((await pending(session, "main")).map((item) => item.lane).toSorted(), [
    "later",
    "now",
    "now",
  ]);

  // Steer input lands one message per answer, in arrival order.
  await stepMain(session, turn);
  assert.equal(await textAt(session, 2), "steer me");
  await stepMain(session, turn);
  assert.equal(await textAt(session, 3), "second answer");
  await stepMain(session, turn);
  assert.equal(await textAt(session, 4), "while streaming");
  await stepMain(session, turn);
  assert.equal(await textAt(session, 5), "third answer");
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["later"],
  );

  // Only once nothing is live does the idle lane land.
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.equal(await textAt(session, 6), "for later");
  await stepMain(session, turn);
  assert.equal(await textAt(session, 7), "fourth answer");
  assert.equal((await stepMain(session, turn)).kind, "idle");
});

/** Flag the live run the way `runs.abort` does: a participant write, not the runner's. */
async function flagAbort(session: Session, run: Run): Promise<void> {
  const current = await session.refs.read(runRef("main"));
  const [flagged] = await session.objects.put([{ ...run, abortRequested: true }]);
  await session.refs.update([{ name: runRef("main"), from: current, to: flagged ?? "" }], {
    reason: "abort",
  });
}

test("an abort that races the response keeps the response, then ends the run at the boundary when nothing is queued", async () => {
  const session = await openSession();
  // One scripted answer: a second response request would fail the script.
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      return complete("finished anyway");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.equal(await textAt(session, 1), "finished anyway");
  assert.equal((await stepMain(session, turn)).kind, "finished");
  const run = await currentRun(session);
  assert.equal(run?.phase.kind, "aborted");
  assert.equal(run?.attempts, 1);
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
});

test("an abort ends the run even with a boundary-lane message waiting; that message starts a new run", async () => {
  const session = await openSession();
  const seen: string[] = [];
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      return {
        kind: "aborted",
        message: assistant("half", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
    async (input) => {
      seen.push(...contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
      return complete("steered answer");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  const run = await currentRun(session);
  assert.ok(run !== undefined);
  await submit(session, { head: "main", lane: "now", body: say("do this instead") });
  await submit(session, { head: "main", lane: "later", body: say("for later") });

  // The abort raced the publish; the interrupted response is kept, and the
  // boundary ends the run without landing the steer into it.
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.equal((await stepMain(session, turn)).kind, "finished");
  const stopped = await currentRun(session);
  assert.equal(stopped?.id, run.id);
  assert.equal(stopped?.phase.kind, "aborted");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
  assert.deepEqual((await pending(session, "main")).map((item) => item.lane).sort(), [
    "later",
    "now",
  ]);

  assert.equal((await stepMain(session, turn)).kind, "continue");
  const steered = await currentRun(session);
  assert.ok(steered !== undefined);
  assert.notEqual(steered.id, run.id);
  assert.equal(steered.phase.kind, "respond");
  assert.equal(steered.abortRequested, undefined);
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.deepEqual(seen, ["user:hi", "user:do this instead"]);
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant", "user", "assistant"]);
  assert.equal((await currentRun(session))?.phase.kind, "done");
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["later"],
  );
});

test("an abort flagged during a tool batch settles the batch, then ends the run; a steer answers as a new run", async () => {
  const session = await openSession();
  const turn = new Script(
    [asks("a"), complete("after steer")],
    [
      async (input) => {
        await flagAbort(input.session, input.run);
        return results("a");
      },
    ],
  );
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  await stepMain(session, turn);
  const run = await currentRun(session);
  assert.equal(run?.phase.kind, "tools");
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant", "toolResult"]);
  assert.equal((await currentRun(session))?.abortRequested, true);

  await submit(session, { head: "main", lane: "now", body: say("steer") });
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.equal((await currentRun(session))?.phase.kind, "aborted");
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.notEqual((await currentRun(session))?.id, run?.id);
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.equal(await textAt(session, 4), "after steer");
  assert.equal((await currentRun(session))?.phase.kind, "done");
});

test("an abort during a retry backoff ends the run without waiting it out", async () => {
  const session = await openSession();
  const start = 10_000;
  const turn = new Script([
    {
      kind: "retry",
      message: assistant("", { stop: "error", error: "429" }),
      at: start + 1_000,
      failure: { class: "rate_limit", message: "429" },
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn, { now: () => start });
  assert.equal((await stepMain(session, turn, { now: () => start })).kind, "retry");
  const run = await currentRun(session);
  assert.ok(run !== undefined);
  await flagAbort(session, run);

  assert.equal((await stepMain(session, turn, { now: () => start + 1 })).kind, "finished");
  assert.equal((await currentRun(session))?.phase.kind, "aborted");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
});

/** The lanes an SDK-like runner serves: user lanes plus a boundary lane for job completions. */
const withResults: Landing = {
  lanes: [...landing.lanes, { lane: "results", lands: "boundary" }],
  drain: "one",
};

function completion(id: string, state: "completed" | "cancelled" = "completed"): CommitBody {
  return {
    kind: "completion",
    job: {
      id,
      kind: "command",
      runId: "earlier-run",
      callId: `call-${id}`,
      head: "main",
      mode: "background",
      state,
      title: `Job ${id}`,
      output: `output of ${id}`,
      startedAt: 1,
      updatedAt: 2,
    },
  };
}

async function stepResults(session: Session, turn: Turn): Promise<ReturnType<typeof step>> {
  return step(session, turn, { head: "main", landing: withResults });
}

test("a completion racing an abort cannot restart the stopped run; it joins the next user message once", async () => {
  const session = await openSession();
  const seen: string[][] = [];
  // Two scripted answers: a completion that woke the stopped run would ask for a third.
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      // The job this stop cancelled reports back before the run has settled.
      await submit(input.session, {
        head: "main",
        lane: "results",
        body: completion("job", "cancelled"),
      });
      return {
        kind: "aborted",
        message: assistant("half", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
    async (input) => {
      seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
      return complete("after the stop");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepResults(session, turn);
  const run = await currentRun(session);
  assert.ok(run !== undefined);

  assert.equal((await stepResults(session, turn)).kind, "continue");
  assert.equal((await stepResults(session, turn)).kind, "finished");
  const stopped = await currentRun(session);
  assert.equal(stopped?.id, run.id);
  assert.equal(stopped?.phase.kind, "aborted");
  assert.equal(stopped?.abortRequested, true);
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["results"],
  );
  const settledAt = await session.events.last();
  assert.equal((await stepResults(session, turn)).kind, "idle");
  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  assert.equal(await session.events.last(), settledAt);
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });

  await submit(session, { head: "main", lane: "now", body: say("and now?") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const answered = await currentRun(session);
  assert.notEqual(answered?.id, run.id);
  assert.equal(answered?.phase.kind, "done");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "user",
    "completion",
    "assistant",
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.filter((entry) => entry.includes("output of job")).length, 1);
  assert.deepEqual(await pending(session, "main"), []);
});

test("a stopped run whose tool batch fails still ends aborted; its failure output stays and a queued completion cannot restart it", async () => {
  const session = await openSession();
  const seen: string[][] = [];
  const turn = new Script(
    [
      asks("a"),
      async (input) => {
        seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
        return complete("after the stop");
      },
    ],
    [
      {
        kind: "failed",
        messages: [toolResult("a", "read", "read blew up", { isError: true })],
        calls: {},
        error: "read blew up",
      },
    ],
  );
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepResults(session, turn);
  await stepResults(session, turn);
  const run = await currentRun(session);
  assert.ok(run !== undefined);
  assert.equal(run.phase.kind, "tools");
  // The stop lands before the batch runs, and the job it cancelled reports back.
  await flagAbort(session, run);
  await submit(session, { head: "main", lane: "results", body: completion("job", "cancelled") });

  assert.equal((await stepResults(session, turn)).kind, "finished");
  const stopped = await currentRun(session);
  assert.equal(stopped?.id, run.id);
  assert.equal(stopped?.phase.kind, "aborted");
  assert.equal(stopped?.abortRequested, true);
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant", "toolResult"]);
  assert.equal(await textAt(session, 2), "read blew up");
  const notices = (await session.events.read({ afterSeq: 0 })).flatMap((event) =>
    event.kind === "notice" ? [event.message] : [],
  );
  assert.ok(notices.some((notice) => notice.includes("read blew up")));

  const settledAt = await session.events.last();
  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  assert.equal(await session.events.last(), settledAt);
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["results"],
  );

  await submit(session, { head: "main", lane: "now", body: say("and now?") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const answered = await currentRun(session);
  assert.notEqual(answered?.id, run.id);
  assert.equal(answered?.phase.kind, "done");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "toolResult",
    "user",
    "completion",
    "assistant",
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.filter((entry) => entry.includes("output of job")).length, 1);
  assert.deepEqual(await pending(session, "main"), []);
});

test("a stopped run that cannot run its tools ends aborted, not failed", async () => {
  const session = await openSession();
  const turn = new Script([asks("a")]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  await stepMain(session, turn);
  const run = await currentRun(session);
  assert.ok(run !== undefined);
  assert.equal(run.phase.kind, "tools");
  await flagAbort(session, run);
  // A participant moved the tip under the batch: the step finds no assistant message to serve.
  const tip = await session.refs.read(headRef("main"));
  const [parent] = await branch(session.objects, tip);
  assert.ok(parent !== undefined);
  await setHead(session, "main", parent.oid);

  assert.equal((await stepMain(session, turn)).kind, "finished");
  const stopped = await currentRun(session);
  assert.equal(stopped?.id, run.id);
  assert.equal(stopped?.phase.kind, "aborted");
  const notices = (await session.events.read({ afterSeq: 0 })).flatMap((event) =>
    event.kind === "notice" ? [event.message] : [],
  );
  assert.ok(notices.some((notice) => notice.includes("no assistant message")));
});

test("a flagged run that an older runner left failed is still stopped: completions wait for user input", async () => {
  const session = await openSession();
  const turn = new Script([complete("fresh")]);
  await seedHead(session, "main", [say("hi"), message(assistant("half"))], { run: "old" });
  const failed: Run = {
    kind: "run",
    id: "old",
    head: "main",
    phase: {
      kind: "failed",
      failure: { class: "runner", message: "tool batch failed while stopping" },
    },
    startedAt: 0,
    attempts: 1,
    config: {},
    abortRequested: true,
  };
  const [failedOid] = await session.objects.put([failed]);
  assert.ok(failedOid !== undefined);
  await session.refs.update([{ name: runRef("main"), from: null, to: failedOid }], {
    reason: "test",
  });
  await submit(session, { head: "main", lane: "results", body: completion("job") });

  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  assert.equal(await session.refs.read(runRef("main")), failedOid);
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });

  await submit(session, { head: "main", lane: "now", body: say("go on") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "user",
    "completion",
    "assistant",
  ]);
});

test("a waiter judges the batch the runner would land: a stray non-user message ahead of user input keeps a stopped head idle under drain one", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      return {
        kind: "aborted",
        message: assistant("", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
    complete("answered"),
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "finished");
  assert.equal((await currentRun(session))?.phase.kind, "aborted");
  // The kernel accepts any commit body in a lane; only the SDK limits messages to user input.
  await submit(session, { head: "main", lane: "now", body: message(assistant("stray")) });
  await submit(session, { head: "main", lane: "now", body: say("go on") });

  // Drain one takes the lane through the stray message, which is not user
  // input: the runner lands nothing, and the waiter reads the same batch.
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "idle");
  assert.deepEqual(await waitForHead(session, { head: "main", drain: "one" }), { kind: "idle" });
  assert.equal((await pending(session, "main")).length, 2);

  // Drain all takes the whole lane, whose user input starts a run; the waiter
  // sees that too and rests only once it is answered.
  const observed = waitForHead(session, { head: "main", drain: "all" });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: { ...landing, drain: "all" } })).kind,
    "finished",
  );
  assert.deepEqual(await observed, { kind: "idle" });
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "assistant",
    "user",
    "assistant",
  ]);
  assert.equal(await textAt(session, 4), "answered");
});

test("a completion queued behind a stop survives closing the store; after reopening it still waits, then joins the next answer once", async () => {
  const path = storePath();
  const store = openStore(path);
  const session = await store.create({ id: "s" });
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      return {
        kind: "aborted",
        message: assistant("", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  assert.equal((await currentRun(session))?.phase.kind, "aborted");
  await submit(session, { head: "main", lane: "results", body: completion("late") });
  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  await store.close();

  const reopened = await openStore(path).open("s");
  const seen: string[][] = [];
  const resumed = new Script([
    async (input) => {
      seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
      return complete("after reopening");
    },
  ]);
  assert.equal(
    (await drive(reopened, resumed, { head: "main", landing: withResults })).kind,
    "idle",
  );
  assert.deepEqual(await waitForHead(reopened, { head: "main" }), { kind: "idle" });
  assert.deepEqual(await branchBodyRoles(reopened), ["user", "assistant"]);
  assert.equal((await pending(reopened, "main")).length, 1);

  await submit(reopened, { head: "main", lane: "now", body: say("and now?") });
  assert.equal(
    (await drive(reopened, resumed, { head: "main", landing: withResults })).kind,
    "finished",
  );
  assert.deepEqual(await branchBodyRoles(reopened), [
    "user",
    "assistant",
    "user",
    "completion",
    "assistant",
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.filter((entry) => entry.includes("output of late")).length, 1);
  assert.deepEqual(await pending(reopened, "main"), []);
});

test("configuration after a stop applies without resuming, and the next message uses it from any lane", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      return {
        kind: "aborted",
        message: assistant("", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
    complete("configured answer"),
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const stopped = await currentRun(session);
  assert.equal(stopped?.phase.kind, "aborted");
  const stoppedOid = await session.refs.read(runRef("main"));

  await submit(session, { head: "main", lane: "results", body: completion("job") });
  await submit(session, {
    head: "main",
    lane: "later",
    body: { kind: "config", thinkingLevel: "high" },
  });
  // Twice: the config still has to land, and the stop must survive it.
  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant", "config"]);
  assert.equal(await session.refs.read(runRef("main")), stoppedOid);
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["results"],
  );
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });

  await submit(session, { head: "main", lane: "now", body: say("go on") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const answered = await currentRun(session);
  assert.notEqual(answered?.id, stopped?.id);
  assert.equal(answered?.config.thinkingLevel, "high");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "config",
    "user",
    "completion",
    "assistant",
  ]);
  assert.equal(await textAt(session, 5), "configured answer");
});

test("a repeated abort changes nothing, before or after the run ends", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      await flagAbort(input.session, { ...input.run, abortRequested: true });
      return {
        kind: "aborted",
        message: assistant("", { stop: "aborted" }),
        failure: { class: "aborted", message: "Aborted" },
      };
    },
    complete("fresh"),
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "finished");
  const stopped = await currentRun(session);
  assert.ok(stopped !== undefined);
  assert.equal(stopped.phase.kind, "aborted");
  const before = await session.events.last();
  await flagAbort(session, stopped);
  assert.equal(await session.events.last(), before);
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "idle");

  await submit(session, { head: "main", lane: "later", body: say("again") });
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "finished");
  assert.notEqual((await currentRun(session))?.id, stopped.id);
  assert.equal(await textAt(session, 3), "fresh");
});

/** A head whose last run ended without a stop, or never ran; each is as idle as a stopped one. */
const idleHeads: readonly {
  readonly name: string;
  readonly settle: (session: Session) => Promise<void>;
}[] = [
  {
    name: "a run that finished on its own",
    settle: async (session) => {
      const turn = new Script([complete("first")]);
      await submit(session, { head: "main", lane: "now", body: say("hi") });
      assert.equal(
        (await drive(session, turn, { head: "main", landing: withResults })).kind,
        "finished",
      );
      assert.equal((await currentRun(session))?.phase.kind, "done");
    },
  },
  {
    name: "a run that failed",
    settle: async (session) => {
      await submit(session, { head: "main", lane: "now", body: say("hi") });
      // A ceiling of zero fails the run before its first response is asked for.
      assert.equal(
        (
          await drive(session, new Script(), {
            head: "main",
            landing: withResults,
            steps: 0,
          })
        ).kind,
        "finished",
      );
      assert.equal((await currentRun(session))?.phase.kind, "failed");
    },
  },
  {
    name: "a head that never ran",
    settle: async (session) => {
      assert.equal(await currentRun(session), undefined);
    },
  },
];

for (const { name, settle } of idleHeads) {
  test(`completed work after ${name} starts nothing; the next user message hears it once, as a new run`, async () => {
    const session = await openSession();
    const seen: string[][] = [];
    // One scripted answer: a completion that woke the model on its own would ask for a second.
    const turn = new Script([
      async (input) => {
        seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
        return complete("noted");
      },
    ]);
    await settle(session);
    const before = await currentRun(session);
    const branchBefore = await branchBodyRoles(session);

    await submit(session, { head: "main", lane: "results", body: completion("job") });
    const settledAt = await session.events.last();
    assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
    assert.equal(
      (await drive(session, turn, { head: "main", landing: { ...withResults, drain: "all" } }))
        .kind,
      "idle",
    );
    assert.equal(await session.events.last(), settledAt);
    assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });
    assert.deepEqual((await currentRun(session))?.id, before?.id);
    assert.deepEqual(await branchBodyRoles(session), branchBefore);
    assert.deepEqual(
      (await pending(session, "main")).map((item) => item.lane),
      ["results"],
    );
    assert.equal(seen.length, 0);

    await submit(session, { head: "main", lane: "now", body: say("and now?") });
    assert.equal(
      (await drive(session, turn, { head: "main", landing: withResults })).kind,
      "finished",
    );
    const answered = await currentRun(session);
    assert.ok(answered !== undefined);
    assert.notEqual(answered.id, before?.id);
    assert.equal(answered.phase.kind, "done");
    assert.deepEqual(await branchBodyRoles(session), [
      ...branchBefore,
      "user",
      "completion",
      "assistant",
    ]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.filter((entry) => entry.includes("output of job")).length, 1);
    assert.deepEqual(await pending(session, "main"), []);
  });
}

test("configuration after a natural finish applies under the finished run; only the next message starts a run, with that config", async () => {
  const session = await openSession();
  const turn = new Script([complete("first"), complete("configured answer")]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const finished = await currentRun(session);
  assert.equal(finished?.phase.kind, "done");
  const finishedOid = await session.refs.read(runRef("main"));

  await submit(session, { head: "main", lane: "results", body: completion("job") });
  await submit(session, {
    head: "main",
    lane: "later",
    body: { kind: "config", thinkingLevel: "high" },
  });
  assert.equal((await drive(session, turn, { head: "main", landing: withResults })).kind, "idle");
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant", "config"]);
  assert.equal(await session.refs.read(runRef("main")), finishedOid);
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["results"],
  );
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });

  await submit(session, { head: "main", lane: "now", body: say("go on") });
  assert.equal(
    (await drive(session, turn, { head: "main", landing: withResults })).kind,
    "finished",
  );
  const answered = await currentRun(session);
  assert.notEqual(answered?.id, finished?.id);
  assert.equal(answered?.config.thinkingLevel, "high");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "config",
    "user",
    "completion",
    "assistant",
  ]);
  assert.equal(await textAt(session, 5), "configured answer");
});

test("a checkpoint continues the run that asked for it; a stop during the checkpoint still ends that run before any response", async () => {
  const session = await openSession();
  const checkpoint = (summary: string): RespondOutcome => ({
    kind: "checkpoint",
    body: { kind: "checkpoint", summary, retainedTail: [], tokensBefore: 10 },
  });
  const turn = new Script([checkpoint("so far"), complete("after compaction")]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  assert.equal((await stepResults(session, turn)).kind, "continue");
  const run = await currentRun(session);
  assert.ok(run !== undefined);
  assert.equal((await stepResults(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), ["user", "checkpoint"]);
  assert.equal((await currentRun(session))?.id, run.id);
  // The same run answers after its checkpoint; no new input was needed.
  assert.equal((await stepResults(session, turn)).kind, "finished");
  assert.equal((await currentRun(session))?.id, run.id);
  assert.equal(await textAt(session, 2), "after compaction");

  const stopping = new Script([
    async (input) => {
      await flagAbort(input.session, input.run);
      await submit(input.session, { head: "main", lane: "results", body: completion("job") });
      return checkpoint("cut short");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("more") });
  assert.equal((await stepResults(session, stopping)).kind, "continue");
  const second = await currentRun(session);
  assert.ok(second !== undefined && second.id !== run.id);
  assert.equal((await stepResults(session, stopping)).kind, "continue");
  // The checkpoint's publish asserts the run ref, which the stop moved: the
  // checkpoint is dropped, and the flagged run ends at its next step. The
  // completion it left queued cannot make the model answer.
  assert.deepEqual(await branchBodyRoles(session), ["user", "checkpoint", "assistant", "user"]);
  assert.equal((await stepResults(session, stopping)).kind, "finished");
  const stopped = await currentRun(session);
  assert.equal(stopped?.id, second.id);
  assert.equal(stopped?.phase.kind, "aborted");
  assert.equal(
    (await drive(session, stopping, { head: "main", landing: withResults })).kind,
    "idle",
  );
  assert.deepEqual(await waitForHead(session, { head: "main" }), { kind: "idle" });
  assert.deepEqual(
    (await pending(session, "main")).map((item) => item.lane),
    ["results"],
  );
});

test("while an input awaits its answer, a lane mixing completions and input contributes only the completions", async () => {
  const session = await openSession();
  const seen: string[][] = [];
  const turn = new Script([
    async (input) => {
      seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
      return complete("one");
    },
    async (input) => {
      seen.push(contextMessages(input.commits.map((entry) => entry.commit)).map(roleText));
      return complete("two");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("first") });
  assert.equal((await stepResults(session, turn)).kind, "continue");
  await submit(session, { head: "main", lane: "results", body: completion("job") });
  await submit(session, { head: "main", lane: "results", body: say("second") });

  assert.equal((await stepResults(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), ["user", "completion"]);
  assert.equal((await stepResults(session, turn)).kind, "finished");
  assert.deepEqual(
    seen[0]?.map((entry) => entry.split(":")[0]),
    ["user", "user"],
  );
  assert.equal((await stepResults(session, turn)).kind, "continue");
  assert.equal((await stepResults(session, turn)).kind, "finished");
  assert.equal(seen[1]?.at(-1), "user:second");
  assert.equal(await textAt(session, 4), "two");
});

function roleText(entry: Message): string {
  const content = entry.content;
  const text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : content;
  return `${entry.role}:${text}`;
}

test("a head moved under a run ends the run and leaves its answer off the branch", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      await moveHead(input.session, { head: "main", to: null });
      return complete("orphan");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  assert.equal((await stepMain(session, turn)).kind, "finished");
  assert.equal((await currentRun(session))?.phase.kind, "aborted");
  assert.equal(await session.refs.read(headRef("main")), null);
});

test("a transient failure waits out its backoff durably, then tries again", async () => {
  const session = await openSession();
  const start = 10_000;
  const turn = new Script([
    {
      kind: "retry",
      message: assistant("", { stop: "error", error: "429" }),
      at: start + 1_000,
      failure: { class: "rate_limit", message: "429" },
    },
    complete("recovered"),
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn, { now: () => start });
  const failed = await stepMain(session, turn, { now: () => start });
  assert.equal(failed.kind, "retry");
  if (failed.kind === "retry") assert.equal(failed.at, start + 1_000);
  assert.deepEqual(await branchBodyRoles(session), ["user", "assistant"]);

  const waitingRun = await session.refs.read(runRef("main"));
  const waitingTip = await session.refs.read(headRef("main"));
  const early = await stepMain(session, turn, { now: () => start + 500 });
  assert.equal(early.kind, "retry");
  assert.equal(await session.refs.read(runRef("main")), waitingRun);
  assert.equal(await session.refs.read(headRef("main")), waitingTip);

  assert.equal((await stepMain(session, turn, { now: () => start + 2_000 })).kind, "finished");
  assert.equal((await currentRun(session))?.attempts, 2);
  assert.equal(await textAt(session, 2), "recovered");
});

test("a run stops at its response ceiling, fixed or decided per run", async () => {
  const session = await openSession();
  const turn = new Script([complete("one"), complete("two")]);
  await submit(session, { head: "main", lane: "now", body: say("go") });
  await stepMain(session, turn, { steps: 1 });
  await stepMain(session, turn, { steps: 1 });
  await submit(session, { head: "main", lane: "now", body: say("more") });
  await stepMain(session, turn, { steps: 1 });
  await stepMain(session, turn, { steps: 1 });
  await stepMain(session, turn, { steps: 1 });
  assert.equal((await currentRun(session))?.phase.kind, "done");
  assert.equal(await textAt(session, 1), "one");
  assert.equal(await textAt(session, 3), "two");

  const ceilingByRun = (run: Run): number => (run.attempts >= 0 ? 0 : 1);
  await submit(session, { head: "main", lane: "now", body: say("blocked") });
  await stepMain(session, turn, { steps: ceilingByRun });
  const outcome = await stepMain(session, turn, { steps: ceilingByRun });
  assert.equal(outcome.kind, "finished");
  const run = await currentRun(session);
  assert.equal(run?.phase.kind, "failed");
  assert.equal(run?.attempts, 0);
});

test("a head held by another runner is busy; a runner that loses its lease publishes nothing", async () => {
  const session = await openSession();
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  const holder = granted(await session.leases.acquire(headRef("main"), 30_000));
  const busy = await stepMain(session, new Script());
  assert.equal(busy.kind, "busy");
  await session.leases.release(holder);

  const turn = new Script([
    async (input) => {
      await input.session.leases.release(input.lease);
      granted(await input.session.leases.acquire(headRef("main"), 30_000));
      return complete("too late");
    },
  ]);
  await stepMain(session, turn);
  const before = await session.events.last();
  const fenced = await stepMain(session, turn);
  assert.equal(fenced.kind, "fenced");
  assert.deepEqual(await branchBodyRoles(session), ["user"]);
  assert.equal(await session.events.last(), before);
});

test("drive runs a head to idle under one lease; a parked run releases the head and consumes nothing until its answer arrives", async () => {
  const session = await openSession();
  const turn = new Script([asks("c1"), complete("all done")], [results("c1")]);
  await submit(session, { head: "main", lane: "now", body: say("go") });
  const outcome = await drive(session, turn, { head: "main", landing });
  assert.equal(outcome.kind, "finished");
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
  assert.equal(await session.leases.read(headRef("main")), undefined);
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "idle");

  let runId = "";
  const parked = new Script(
    [asks("ask"), complete("thanks")],
    [
      async (input) => {
        runId = input.run.id;
        const opened = await openEffect(input.session, {
          lease: input.lease,
          runId,
          callId: "ask",
          tool: "read",
          args: {},
          replay: "never",
        });
        assert.ok(opened.kind === "opened");
        await parkEffect(input.session, { lease: input.lease, view: opened.view });
        return { kind: "waiting", calls: ["ask"] };
      },
      results("ask"),
    ],
  );
  await submit(session, { head: "main", lane: "now", body: say("ask") });
  assert.equal((await drive(session, parked, { head: "main", landing })).kind, "waiting");
  assert.equal(await session.leases.read(headRef("main")), undefined);

  // Polling a parked run without an answer writes nothing.
  const before = await session.events.last();
  assert.equal((await drive(session, parked, { head: "main", landing })).kind, "waiting");
  assert.equal(await session.events.last(), before);

  assert.equal(
    (await signalEffect(session, { runId, callId: "ask", signal: "42" })).kind,
    "signalled",
  );
  assert.equal((await drive(session, parked, { head: "main", landing })).kind, "finished");
  assert.equal(await textAt(session, 6), "out ask");
  assert.equal(await textAt(session, 7), "thanks");
});

test("a waiting run resumes when every effect already has a result", async () => {
  const session = await openSession();
  const turn = new Script(
    [asks("ask"), complete("thanks")],
    [
      async (input) => {
        const opened = await openEffect(input.session, {
          lease: input.lease,
          runId: input.run.id,
          callId: "ask",
          tool: "read",
          args: {},
          replay: "never",
        });
        assert.ok(opened.kind === "opened");
        await parkEffect(input.session, { lease: input.lease, view: opened.view });
        return { kind: "waiting", calls: ["ask"] };
      },
      results("ask"),
    ],
  );
  await submit(session, { head: "main", lane: "now", body: say("ask") });
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "waiting");

  const current = await currentRun(session);
  assert.ok(current);
  const [waiting] = await listEffects(session, current.id);
  assert.ok(waiting?.effect.state === "waiting");
  const held = granted(await session.leases.acquire(headRef("main"), 30_000));
  assert.equal(
    (
      await settleEffect(session, {
        lease: held,
        view: waiting,
        result: toolResult("ask", "read", "out ask"),
      })
    ).kind,
    "settled",
  );
  assert.equal(await session.leases.release(held), true);

  const observed = waitForHead(session, { head: "main" });
  assert.equal((await drive(session, turn, { head: "main", landing })).kind, "finished");
  assert.deepEqual(await observed, { kind: "idle" });
  assert.deepEqual(await branchBodyRoles(session), [
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
});

test("a session marked deleted is left alone", async () => {
  const session = await openSession();
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  const [marker] = await session.objects.put([{ kind: "blob", value: { at: 1 } }]);
  await session.refs.update([{ name: DELETED_REF, from: null, to: marker ?? "" }], {
    reason: "delete",
  });
  const before = await session.events.last();
  assert.equal((await stepMain(session, new Script())).kind, "idle");
  assert.equal(await session.events.last(), before);
});

test("configuration alone lands already done without a response", async () => {
  const session = await openSession();
  const turn = new Script();
  await submit(session, {
    head: "main",
    lane: "now",
    body: { kind: "config", thinkingLevel: "xhigh" },
  });
  assert.equal((await stepMain(session, turn)).kind, "continue");
  assert.deepEqual(await branchBodyRoles(session), ["config"]);
  assert.equal((await currentRun(session))?.phase.kind, "done");
  assert.deepEqual((await currentRun(session))?.config, { thinkingLevel: "xhigh" });
  assert.equal((await stepMain(session, turn)).kind, "idle");
  assert.equal((await currentRun(session))?.attempts, 0);
});

test("what the turn streams reaches the event stream, in order, before the answer lands", async () => {
  const session = await openSession();
  const turn = new Script([
    async (input) => {
      for (const [index, piece] of ["he", "llo"].entries()) {
        input.emit({
          kind: "delta",
          runId: input.run.id,
          attempt: input.attempt,
          index: 0,
          part: "text",
          delta: piece,
        });
        if (index === 0) await sleep(1);
      }
      return complete("hello");
    },
  ]);
  await submit(session, { head: "main", lane: "now", body: say("hi") });
  await stepMain(session, turn);
  const before = await session.events.last();
  await stepMain(session, turn);
  const events = await session.events.read({ afterSeq: before });
  const deltas = events.flatMap((event) => (event.kind === "delta" ? [event.delta] : []));
  assert.deepEqual(deltas, ["he", "llo"]);
  const lastDelta = events.findLastIndex((event) => event.kind === "delta");
  const publish = events.findIndex(
    (event) => event.kind === "ref" && event.name === headRef("main"),
  );
  assert.ok(lastDelta < publish);
});
