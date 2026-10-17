import { clearSpans, definePart, enableTracing } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { afterEach, assert, beforeAll, expect, it } from "vitest";
import {
  afterTool,
  afterUser,
  CI_PROMPT,
  ciHome,
  ciRepo,
  fakeModels,
  lastToolText,
  script,
} from "../../src/bench/index.ts";
import {
  expectSettledViews,
  openScenario,
  removeFolders,
  savePerturbation,
  settledTool,
  start,
  until,
  waterfall,
  watchViews,
} from "./support.ts";

beforeAll(() => enableTracing());

afterEach(async () => {
  clearSpans();
  await removeFolders();
});

/** The modal a terminal approval asks in: which command, allow or deny. */
const approval = definePart({
  kind: "perturbation/approve-command",
  state: standard(Type.Object({ command: Type.String() })),
  actions: {
    allow: { input: standard(Type.Object({})) },
    deny: { input: standard(Type.Object({})) },
  },
  fallback: (state, { id }) => `Run ${state.command}? (${id})`,
});

/** Asks the user before each `bash` call, in a modal the run waits on. */
const terminalApproval: Plugin<"core"> = {
  id: "terminal-approval",
  contribute: { parts: [approval] },
  hooks: {
    before_tool: async (call, context) => {
      if (call.name !== "bash") return { action: "continue" };

      const command = JSON.stringify(call.args);

      const part = await context.api.session.parts.create(approval, {
        state: { command },
        placement: { kind: "modal" },
      });

      const outcome = await context.wait({ kind: "part", part: part.id });

      return outcome.kind === "part" && outcome.answer?.action === "allow"
        ? { action: "continue" }
        : { action: "reject", reason: "The user did not allow this command." };
    },
  },
};

const ANSWER = "You declined `node --test`, so I have not run the tests.";

it("rejects a terminal command the user denies: the model is told, nothing runs, nothing waits", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp" });

  const turns = script([
    {
      name: "run the tests",
      when: afterUser,
      reply: {
        content: [
          { type: "toolCall", id: "test", name: "bash", arguments: { command: "node --test" } },
        ],
      },
    },
    {
      name: "answer",
      when: afterTool("bash"),
      reply: { content: [{ type: "text", text: ANSWER }] },
    },
  ]);

  const fake = fakeModels({ fallback: turns.answer });

  await using host = await openScenario({
    fake,
    home: home.home,
    workspace: repo.root,
    plugins: [terminalApproval],
  });

  const started = performance.now();
  const { trace, session, receipt } = await start(host, CI_PROMPT);
  const watched = watchViews(session);

  const modal = await until(
    async () => {
      const view = await session.view();

      return view.execution.kind === "waiting"
        ? view.parts.find((part) => part.partKind === approval.kind)
        : undefined;
    },
    10_000,
    "the approval modal",
  );

  const waiting = await session.view();

  expect(waiting.execution).toMatchObject({
    kind: "waiting",
    on: { kind: "part", part: modal.id },
  });
  expect(waiting.turns.at(-1)?.state.kind).toBe("waiting");
  expect(await session.part(modal.id).act("deny", {})).toMatchObject({ kind: "ok" });

  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);
  const final = await expectSettledViews(session, watched);
  const bash = settledTool(final.messages, "bash");

  expect(end.kind).toBe("completed");
  expect(turns.pending()).toEqual([]);
  assert(bash.outcome.kind === "rejected");
  expect(bash.outcome.reason).toBe("The user did not allow this command.");
  expect(fake.requests.map(lastToolText)).toContainEqual(
    expect.stringContaining("The user did not allow this command."),
  );
  const modals = final.parts.filter((part) => part.partKind === approval.kind);

  expect(modals.map((part) => part.status)).toEqual([
    expect.objectContaining({ kind: "live", answer: { action: "deny", input: {} } }),
  ]);
  expect(final.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: ANSWER } });

  const traced = waterfall(trace);

  expect(traced.rows.filter((row) => row.name.startsWith("pty."))).toEqual([]);

  await savePerturbation("terminal-approval-denied", [traced], {
    perturbation:
      "Terminal approval denied: a before_tool plugin asks in a modal before bash runs; the user denies `node --test`",
    expected:
      "The run waits (not working) on the modal; deny rejects the call with the reason, the model reads it, no process spawns, the modal is answered, the run completes.",
    observed: `while asking: execution ${waiting.execution.kind}, turn ${waiting.turns.at(-1)?.state.kind}; bash ${bash.outcome.kind}: "${bash.outcome.reason}"; pty spans 0; the modal stays in view.parts as live and answered (deny), so a client must hide answered modals`,
    wallMs: wall,
  });
});
