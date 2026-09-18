import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { Type } from "typebox";
import {
  expireEffect,
  openEffect,
  parkEffect,
  readEffect,
  settleEffect,
  signalEffect,
} from "../../src/kernel/effects.ts";
import { branch } from "../../src/kernel/graph.ts";
import { headRef, runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { step } from "../../src/kernel/step.ts";
import { bindTurn, type TurnOptions } from "../../src/kernel/turn.ts";
import { ToolWait, type AgentTool } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  call,
  landing,
  lease,
  message,
  openSession,
  toolResult,
  user,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};
const result = { content: [{ type: "text" as const, text: "local" }], details: {} };

async function fixture(ids = ["call"]) {
  const session = await openSession();
  const held = await lease(session, "main");
  const requested = assistant("", { calls: ids.map((id) => call(id, "test")) });
  const makeTurn = (tool: Pick<AgentTool, "execute" | "wake">, loop?: TurnOptions["loop"]) =>
    bindTurn({
      model,
      systemPrompt: "test",
      loop,
      tools: [
        {
          name: "test",
          description: "Controlled work",
          parameters: Type.Object({}),
          replay: "safe",
          ...tool,
        },
      ],
      streamFn: () => {
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "toolUse", message: requested });
        return stream;
      },
    });
  const bootstrap = makeTurn({ execute: async () => result });
  await submit(session, { head: "main", lane: "now", body: message(user("go")) });
  const advance = (turn: ReturnType<typeof makeTurn>, owner = held) =>
    step(session, turn, { head: "main", landing, lease: owner });
  assert.equal((await advance(bootstrap)).kind, "continue");
  assert.equal((await advance(bootstrap)).kind, "continue");
  const runOid = await session.refs.read(runRef("main"));
  assert.ok(runOid);
  const run = await session.objects.get(runOid);
  assert.ok(run?.kind === "run");
  const tip = await session.refs.read(headRef("main"));
  const input = {
    session,
    lease: held,
    run,
    now: 1,
    attempt: run.attempts,
    commits: await branch(session.objects, tip),
    assistant: requested,
    telemetry: NOOP_TELEMETRY_CONTEXT,
    signal: new AbortController().signal,
    emit: () => {},
  };
  const open = (callId = "call") =>
    openEffect(session, {
      lease: held,
      runId: run.id,
      callId,
      tool: "test",
      args: {},
      replay: "safe",
    });
  const read = (callId = "call") => readEffect(session, { runId: run.id, callId });
  const takeover = async () => {
    assert.equal(await session.leases.release(held), true);
    return lease(session, "main");
  };
  const unchanged = async () => {
    assert.equal(await session.refs.read(headRef("main")), tip);
    assert.equal(await session.refs.read(runRef("main")), runOid);
    assert.equal((await branch(session.objects, tip)).at(-1)?.commit.body.kind, "message");
  };
  return { session, held, input, makeTurn, advance, open, read, takeover, unchanged };
}

for (const state of ["missing", "intent", "waiting", "expired", "signal", "result"] as const) {
  test(`takeover fences ${state} open and recovery without execution or publication`, async () => {
    const f = await fixture();
    let executions = 0;
    let wakes = 0;
    const turn = f.makeTurn({
      execute: async () => {
        executions++;
        return result;
      },
      wake: async () => {
        wakes++;
        return { kind: "settle", result };
      },
    });
    if (state !== "missing") {
      const opened = await f.open();
      assert.ok(opened.kind === "opened");
      if (state === "waiting" || state === "expired" || state === "signal") {
        assert.equal(
          (
            await parkEffect(f.session, {
              lease: f.held,
              view: opened.view,
              ...(state === "expired" ? { until: 0 } : {}),
            })
          ).kind,
          "parked",
        );
      }
      if (state === "expired") {
        const waiting = await f.read();
        assert.ok(waiting);
        assert.equal(
          (await expireEffect(f.session, { lease: f.held, view: waiting, now: 0 })).kind,
          "expired",
        );
      }
      if (state === "signal") {
        assert.equal(
          (await signalEffect(f.session, { runId: f.input.run.id, callId: "call", signal: "yes" }))
            .kind,
          "signalled",
        );
      }
      if (state === "result") {
        assert.equal(
          (
            await settleEffect(f.session, {
              lease: f.held,
              view: opened.view,
              result: toolResult("call", "test", "winner"),
            })
          ).kind,
          "settled",
        );
      }
    }
    const stored = await f.read();
    await f.takeover();
    const refs = await f.session.refs.list("");
    const cursor = await f.session.events.last();
    assert.deepEqual(await f.open(), { kind: "fenced" });
    assert.deepEqual(await turn.tools(f.input), { kind: "fenced" });
    assert.deepEqual(await f.advance(turn), { kind: "fenced" });
    if (stored !== undefined && stored.effect.state !== "result") {
      assert.deepEqual(
        await settleEffect(f.session, {
          lease: f.held,
          view: stored,
          result: toolResult("call", "test", "loser"),
        }),
        { kind: "fenced" },
      );
      if (stored.effect.state !== "waiting") {
        assert.deepEqual(await parkEffect(f.session, { lease: f.held, view: stored }), {
          kind: "fenced",
        });
      }
    }
    assert.equal(executions, 0);
    assert.equal(wakes, 0);
    assert.deepEqual(await f.read(), stored);
    assert.deepEqual(await f.session.refs.list(""), refs);
    assert.equal(await f.session.events.last(), cursor);
    await f.unchanged();
  });
}

for (const boundary of ["park", "settle", "repark", "wake-settle"] as const) {
  for (const through of ["turn", "step"] as const) {
    test(`${through}: lease loss during ${boundary} preserves the recoverable effect`, async () => {
      const f = await fixture();
      const waking = boundary === "repark" || boundary === "wake-settle";
      if (waking) {
        const opened = await f.open();
        assert.ok(opened.kind === "opened");
        assert.equal(
          (await parkEffect(f.session, { lease: f.held, view: opened.view })).kind,
          "parked",
        );
        assert.equal(
          (await signalEffect(f.session, { runId: f.input.run.id, callId: "call", signal: "yes" }))
            .kind,
          "signalled",
        );
      }
      let cursor = 0;
      const lose = async () => {
        await f.takeover();
        cursor = await f.session.events.last();
      };
      const turn = f.makeTurn(
        {
          execute: async () => {
            const intent = await f.read();
            assert.ok(intent?.effect.state === "intent", "intent precedes side effects");
            if (boundary === "park") {
              await lose();
              throw new ToolWait();
            }
            return result;
          },
          wake: async () => {
            if (boundary === "repark") {
              await lose();
              return { kind: "wait" };
            }
            return { kind: "settle", result };
          },
        },
        {
          afterToolCall: async () => {
            await lose();
            return undefined;
          },
        },
      );
      const outcome = through === "turn" ? await turn.tools(f.input) : await f.advance(turn);
      assert.deepEqual(outcome, { kind: "fenced" });
      assert.equal((await f.read())?.effect.state, waking ? "signal" : "intent");
      assert.equal(await f.session.events.last(), cursor);
      await f.unchanged();
    });
  }
}

test("allowing a pending policy after an earlier fence starts no later intent or executor", async () => {
  const f = await fixture(["first", "later"]);
  const release = Promise.withResolvers<void>();
  const lost = Promise.withResolvers<void>();
  const executed: string[] = [];
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled++;
  };
  process.on("unhandledRejection", onUnhandled);
  const turn = f.makeTurn(
    {
      execute: async (id) => {
        executed.push(id);
        return result;
      },
    },
    {
      beforeToolCall: async ({ toolCall }) => {
        if (toolCall.id === "later") await release.promise;
        return undefined;
      },
      afterToolCall: async () => {
        await f.takeover();
        lost.resolve();
        return undefined;
      },
    },
  );
  const batch = turn.tools(f.input);
  try {
    await within(lost.promise);
    await setImmediate();
    release.resolve();
    assert.deepEqual(await within(batch), { kind: "fenced" });
    await setImmediate();
    assert.equal(unhandled, 0);
    assert.deepEqual(executed, ["first"]);
    assert.equal(await f.read("later"), undefined);
    assert.equal((await f.read("first"))?.effect.state, "intent");
    await f.unchanged();
  } finally {
    release.resolve();
    await batch;
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

for (const through of ["turn", "step"] as const) {
  test(`${through}: a competing settlement keeps its winner and the next step publishes without execution`, async () => {
    const f = await fixture();
    let executions = 0;
    let cursor = 0;
    const winner = toolResult("call", "test", "winner");
    const turn = f.makeTurn(
      {
        execute: async () => {
          executions++;
          return result;
        },
      },
      {
        afterToolCall: async () => {
          const view = await f.read();
          assert.ok(view?.effect.state === "intent");
          assert.equal(
            (await settleEffect(f.session, { lease: f.held, view, result: winner })).kind,
            "settled",
          );
          cursor = await f.session.events.last();
          return undefined;
        },
      },
    );
    assert.deepEqual(through === "turn" ? await turn.tools(f.input) : await f.advance(turn), {
      kind: through === "turn" ? "conflict" : "continue",
    });
    const stored = await f.read();
    assert.ok(stored?.effect.state === "result");
    assert.deepEqual(stored.effect.result, winner);
    assert.equal(await f.session.events.last(), cursor);
    await f.unchanged();
    assert.deepEqual(await f.advance(turn), { kind: "continue" });
    const tip = await f.session.refs.read(headRef("main"));
    const history = await branch(f.session.objects, tip);
    const body = history.at(-1)?.commit.body;
    assert.ok(body?.kind === "message" && body.message.role === "toolResult");
    assert.deepEqual(body.message.content, winner.content);
    assert.equal(body.message.isError, false);
    assert.equal(executions, 1);
    assert.equal(await f.read(), undefined);
    const runOid = await f.session.refs.read(runRef("main"));
    assert.ok(runOid);
    const run = await f.session.objects.get(runOid);
    assert.ok(run?.kind === "run" && run.phase.kind === "respond");
  });
}

test("an unexpected closed-store open remains a failed batch with its original cause", async () => {
  const f = await fixture();
  let executions = 0;
  const turn = f.makeTurn({
    execute: async () => {
      executions++;
      return result;
    },
  });
  await f.session.close();
  const outcome = await turn.tools(f.input);
  assert.ok(outcome.kind === "failed");
  assert.ok(outcome.cause instanceof Error);
  assert.match(outcome.cause.message, /Session is closed/u);
  assert.deepEqual(outcome.messages, []);
  assert.equal(executions, 0);
});
