import { clearSpans, enableTracing, readSpans } from "@nyte-ai/core";
import { afterEach, assert, beforeAll, expect, it } from "vitest";
import {
  afterTool,
  afterUser,
  CI_PROMPT,
  ciHome,
  ciRepo,
  fakeModels,
  lastToolText,
  readSpanFile,
  script,
  simulate,
} from "../../src/index.ts";
import {
  expectSettledViews,
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

const BRIEF =
  "Read job 2's log with mcp__ci__get_job_logs and name the failing test and its file:line.";

const FOUND = "`sum adds` fails at test/sum.test.js:6: -1 !== 3.";

const ANSWER = "The subagent found it: `sum adds` fails at test/sum.test.js:6.";

it("delegates scenario D's log reading to a subagent that calls the CI server, and resumes with its answer", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp" });

  const turns = script([
    {
      name: "delegate the log",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "task",
            name: "task",
            arguments: { prompt: BRIEF, title: "Log reader" },
          },
        ],
      },
    },
    {
      name: "subagent reads the log",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "log",
            name: "mcp__ci__get_job_logs",
            arguments: { job_id: 2 },
          },
        ],
      },
    },
    {
      name: "subagent answers",
      when: afterTool("mcp__ci__get_job_logs"),
      reply: { content: [{ type: "text", text: FOUND }] },
    },
    {
      name: "answer",
      when: afterTool("task"),
      reply: { content: [{ type: "text", text: ANSWER }] },
    },
  ]);

  const fake = fakeModels({ fallback: turns.answer });

  await using simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: repo.root,
  });

  const { host } = simulation;
  const started = performance.now();
  const { trace, session: parent, receipt } = await start(host, CI_PROMPT);
  const watched = watchViews(parent);

  const waiting = await until(
    async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" ? execution : undefined;
    },
    10_000,
    "the parent to wait on its subagent",
  );

  expect(waiting.on.kind).toBe("run");
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);

  expect(end.kind).toBe("completed");
  expect(turns.pending()).toEqual([]);

  const children = await host.sessions.list({ parents: { kind: "children", session: parent.id } });
  const [child] = children.items;

  assert(child !== undefined);
  expect(children.items).toHaveLength(1);
  expect(child.name).toBe("Log reader");

  const final = await expectSettledViews(parent, watched);
  const delegated = settledTool(final.messages, "task");

  assert(delegated.outcome.kind === "ok");
  expect(lastToolText(fake.requests.findLast(afterTool("task")) ?? fake.requests[0])).toBe(
    `Subagent ${child.id} finished.\n\n${FOUND}`,
  );
  expect(final.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: ANSWER } });

  const childView = await host.session(child.id).view();

  expect(childView.execution.kind).toBe("idle");
  expect(settledTool(childView.messages, "mcp__ci__get_job_logs").outcome.kind).toBe("ok");
  expect(childView.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: FOUND } });

  const served = await readSpanFile(home.traceFile);

  const childSpans = readSpans().filter(
    (span) => span.detail.session === child.id || span.name === "mcp.call",
  );

  const traced = waterfall(trace, [{ process: "mcp:ci", spans: served }]);
  const childTraces = [...new Set(childSpans.map((span) => span.trace))];

  await savePerturbation("subagent-delegation", [traced], {
    perturbation:
      "Subagent delegation: the parent runs `task`, whose child session calls the CI server's get_job_logs",
    expected:
      "The parent waits on the child's run (not working), the child calls the MCP tool, the parent resumes with the child's answer; the child's hops join the submit's trace.",
    observed: `parent waited on ${waiting.on.kind}; run ${end.kind}; task ${delegated.outcome.kind}; child spans under ${childTraces.length === 1 && childTraces[0] === trace ? "the parent's trace" : `traces ${JSON.stringify(childTraces)}`}; mcp.serve trace ${JSON.stringify(served.map((span) => span.trace))}`,
    wallMs: wall,
  });

  expect(childTraces).toEqual([trace]);
  expect(served.map((span) => span.trace)).toEqual([trace]);
});

it("stops a waiting subagent's run when the user stops the parent", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp", env: { CI_DELAY_MS: "5000" } });

  const turns = script([
    {
      name: "delegate the log",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "task",
            name: "task",
            arguments: { prompt: BRIEF, title: "Log reader" },
          },
        ],
      },
    },
    {
      name: "subagent reads the log",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "log",
            name: "mcp__ci__get_job_logs",
            arguments: { job_id: 2 },
          },
        ],
      },
    },
  ]);

  const fake = fakeModels({ fallback: turns.answer });

  await using simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: repo.root,
  });

  const { host } = simulation;
  const started = performance.now();
  const { trace, session: parent, receipt } = await start(host, CI_PROMPT);
  const watched = watchViews(parent);

  const child = await until(
    async () => {
      const [found] = (
        await host.sessions.list({ parents: { kind: "children", session: parent.id } })
      ).items;

      if (found === undefined) return undefined;
      const view = await host.session(found.id).view();

      return view.messages.some(
        (message) =>
          message.kind === "part" &&
          message.partKind === "tool" &&
          JSON.stringify(message.state).includes('"phase":"running"'),
      )
        ? found
        : undefined;
    },
    10_000,
    "the subagent's log call to run",
  );

  await parent.stop();
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);

  const childView = await until(
    async () => {
      const view = await host.session(child.id).view();

      return view.execution.kind === "idle" ? view : undefined;
    },
    3_000,
    "the subagent to stop",
  );

  const final = await expectSettledViews(parent, watched);

  expect(end.kind).toBe("stopped");
  expect(settledTool(final.messages, "task").outcome.kind).toBe("stopped");
  expect(childView.execution).toMatchObject({ lastRun: { end: { kind: "stopped" } } });
  expect(settledTool(childView.messages, "mcp__ci__get_job_logs").outcome.kind).toBe("stopped");
  expect(wall).toBeLessThan(5_000);
  expect(final.messages.at(-1)).toMatchObject({
    kind: "user",
    source: { kind: "child", session: child.id, end: "stopped" },
    delivery: "attach",
    status: { kind: "pending" },
  });

  await savePerturbation("subagent-stop", [waterfall(trace)], {
    perturbation:
      "Subagent delegation stopped: the user stops the parent while its subagent's get_job_logs call takes 5 s",
    expected:
      "Stopping the parent stops the subagent's run and its MCP call; neither is left working.",
    observed: `parent ${end.kind}; task ${settledTool(final.messages, "task").outcome.kind}; child run ${childView.execution.kind === "idle" ? childView.execution.lastRun?.end.kind : childView.execution.kind}; child call ${settledTool(childView.messages, "mcp__ci__get_job_logs").outcome.kind}; the child's stopped report waits in the parent as an attached message`,
    wallMs: wall,
  });
});
