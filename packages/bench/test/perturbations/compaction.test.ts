import { clearSpans, compaction, enableTracing, isPart } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import { afterEach, beforeAll, expect, it } from "vitest";
import {
  CI_ANSWER,
  CI_PROMPT,
  ciHome,
  ciRepo,
  ciScript,
  fakeModels,
  lastToolText,
  lastUserText,
  simulate,
} from "../../src/index.ts";
import type { Request } from "../../src/index.ts";
import {
  expectInOrder,
  expectSettledViews,
  removeFolders,
  savePerturbation,
  submit,
  toolStates,
  waterfall,
  watchViews,
} from "./support.ts";

beforeAll(() => enableTracing());

afterEach(async () => {
  clearSpans();
  await removeFolders();
});

const smallWindow: Plugin<"core"> = {
  id: "small-window",
  contribute: {
    modelContext: [
      { model: { provider: "test", id: "model" }, contextWindow: 100_000, compactAt: 6_000 },
    ],
  },
};

const EARLIER = "Explain how this repository is laid out.";

const EARLIER_ANSWER = `The repository has src/ and test/.\n\n${"- src/sum.js exports sum; test/sum.test.js checks it with node:test.\n".repeat(150)}`;

const SUMMARY =
  "The user asked why CI failed. The ci-triage skill was read; the failing job's log shows `sum adds` failing at test/sum.test.js:6 with -1 !== 3.";

function summarising(request: Request): boolean {
  const first = request.context.messages[0];

  return (
    first?.role === "system" &&
    JSON.stringify(first.content).startsWith(`"You summarise a coding agent's conversation`)
  );
}

it("compacts in the middle of scenario D's run and goes on to the answer with the log tail kept", async () => {
  await using repo = await ciRepo();
  await using home = await ciHome({ route: "mcp" });
  const turns = ciScript({ skill: home.skills["ci-triage"], route: "mcp" });
  const summaries: Request[] = [];

  const fake = fakeModels({
    fallback: (request) => {
      if (request.context.messages.at(-1)?.role === "user" && lastUserText(request) === EARLIER)
        return { content: [{ type: "text", text: EARLIER_ANSWER }] };

      if (!summarising(request)) return turns.answer(request);
      summaries.push(request);

      return { content: [{ type: "text", text: SUMMARY }], usage: { input: 500, output: 60 } };
    },
  });

  await using simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: repo.root,
    plugins: [smallWindow],
  });
  const { host } = simulation;

  const { session, receipt: earlier } = await host.sessions.start({ content: EARLIER });

  await earlier.settled();
  const watched = watchViews(session);
  const started = performance.now();
  const { trace, receipt } = await submit(session, CI_PROMPT);
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);

  expect(end.kind).toBe("completed");
  expect(turns.pending()).toEqual([]);

  const final = await expectSettledViews(session, watched);
  const notes = final.messages.filter((message) => isPart(message, compaction));

  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(notes.map((note) => note.status.kind)).toEqual(summaries.map(() => "settled"));
  expect(final.messages.at(-1)).toMatchObject({ kind: "part", state: { markdown: CI_ANSWER } });
  expect(
    toolStates(final.messages).map((state) =>
      state.phase === "settled" ? state.outcome.kind : state.phase,
    ),
  ).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);

  const after = fake.requests.find(
    (request) =>
      !summarising(request) && JSON.stringify(request.context.messages).includes(SUMMARY),
  );

  expect(after).toBeDefined();

  const summarisedAt = fake.requests.findIndex(summarising);
  const prompt = lastUserText(summaries[0]);

  expect(prompt).toContain(EARLIER);
  expect(prompt).not.toContain("get_job_logs");
  expect(lastToolText(fake.requests[summarisedAt + 1])).toContain("-1 !== 3");
  expect(fake.requests.map(lastToolText).at(-1)).toMatch(/ℹ pass 1[^]*\[exit code 0\]$/u);

  const traced = waterfall(trace);

  expectInOrder(traced.rows, ["host.admit", "mcp.call", "mcp.call", "canvas.compile", "pty.spawn"]);

  await savePerturbation("compaction-mid-flow", [traced], {
    perturbation:
      "Compaction mid-flow: an earlier exchange, then scenario D with a 6 000-token threshold (100 000 window) that the job log crosses",
    expected:
      "The run compacts between steps: the earlier exchange is summarised, the run's own steps (the log tail) are kept, the note settles, and the scenario still ends with the fix and the answer.",
    observed: `run ${end.kind}; ${summaries.length} compaction request(s); notes ${notes.map((note) => note.status.kind).join(", ")}; ${fake.requests.length} model requests; all ${toolStates(final.messages).length} tool calls ok`,
    wallMs: wall,
  });
});
