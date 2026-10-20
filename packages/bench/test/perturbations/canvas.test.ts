import { clearSpans, enableTracing } from "@nyte-ai/core";
import { KIT_SPECIFIER } from "@nyte-ai/plugin/canvas/protocol";
import { asId } from "@nyte-ai/schema";
import { afterEach, assert, beforeAll, expect, it } from "vitest";
import {
  afterTool,
  afterUser,
  fakeModels,
  lastToolText,
  lastUserText,
  RESTAURANT_CANVAS,
  RESTAURANT_PROMPT,
  restaurantHome,
  script,
  simulate,
} from "../../src/index.ts";
import {
  expectSettledViews,
  folder,
  removeFolders,
  savePerturbation,
  start,
  toolStates,
  waterfall,
  watchViews,
} from "./support.ts";

beforeAll(() => enableTracing());

afterEach(async () => {
  clearSpans();
  await removeFolders();
});

const BROKEN = `import { sample } from "lodash";
import { Card } from "${KIT_SPECIFIER}";

export default function Pick() {
  return <Card title="Pick">{sample(["a", "b"])}</Card;
}
`;

const FOREIGN = `import { sample } from "lodash";
import { Card } from "${KIT_SPECIFIER}";

export default function Pick() {
  return <Card title="Pick">{sample(["a", "b"])}</Card>;
}
`;

const ANSWER = "Here is the pick.";

it("tells the model why a canvas did not compile, keeps the canvas it replaces, and shows a client's render error", async () => {
  await using home = await restaurantHome();
  let rendered = "";

  const turns = script([
    {
      name: "render a broken canvas",
      when: afterUser,
      reply: {
        content: [
          {
            type: "toolCall",
            id: "broken",
            name: "canvas_render",
            arguments: { title: "Pick", source: BROKEN },
          },
        ],
      },
    },
    {
      name: "render the fixed canvas",
      when: afterTool("canvas_render"),
      reply: {
        content: [
          {
            type: "toolCall",
            id: "fixed",
            name: "canvas_render",
            arguments: { title: "Random pick nearby", source: RESTAURANT_CANVAS },
          },
        ],
      },
    },
    {
      name: "replace it with a foreign import",
      when: afterTool("canvas_render"),
      reply: (request) => {
        rendered = /Rendered canvas (\S+):/u.exec(lastToolText(request))?.[1] ?? "";

        return {
          content: [
            {
              type: "toolCall",
              id: "foreign",
              name: "canvas_render",
              arguments: { title: "Pick", source: FOREIGN, canvas: rendered },
            },
          ],
        };
      },
    },
    {
      name: "answer",
      when: afterTool("canvas_render"),
      reply: { content: [{ type: "text", text: ANSWER }] },
    },
    {
      name: "read the render error",
      when: (request) => lastUserText(request) === "It is blank.",
      reply: { content: [{ type: "text", text: "It threw; I will fix it." }] },
    },
  ]);

  const fake = fakeModels({ fallback: turns.answer });

  await using simulation = await simulate({
    models: fake.models,
    home: home.home,
    workspace: await folder(),
  });

  const { host } = simulation;
  const started = performance.now();
  const { trace, session, receipt } = await start(host, RESTAURANT_PROMPT);
  const watched = watchViews(session);
  const end = await receipt.settled();
  const wall = Math.round(performance.now() - started);

  expect(end.kind).toBe("completed");

  const calls = toolStates((await session.view()).messages);
  const outcomes = calls.map((state) => (state.phase === "settled" ? state.outcome : null));

  expect(outcomes.map((outcome) => outcome?.kind)).toEqual(["failed", "ok", "failed"]);
  const [broken, , foreign] = outcomes;

  assert(broken?.kind === "failed" && foreign?.kind === "failed");
  expect(broken.message).toMatch(/^The canvas did not compile:\nmain\.tsx:5:\d+ /u);
  expect(foreign.message).toContain("lodash");
  expect(
    fake.requests.map(lastToolText).filter((text) => text.includes("did not compile")),
  ).toHaveLength(2);

  const canvases = (await session.view()).messages.filter(
    (message) => message.kind === "part" && message.partKind === "canvas",
  );

  expect(canvases.map((message) => message.id)).toEqual([rendered]);
  const [canvas] = canvases;

  assert(canvas?.kind === "part");
  expect(canvas.version).toBe(1);
  expect(canvas.state).toMatchObject({ title: "Random pick nearby", error: null });

  expect(
    await session.part(asId(rendered)).act("report", { message: "TypeError: pick is undefined" }),
  ).toMatchObject({ kind: "ok" });
  await (await session.send("It is blank.")).settled();

  const reread = fake.requests.findLast((request) => lastUserText(request) === "It is blank.");

  expect(JSON.stringify(reread?.context.messages)).toContain(
    "It failed to render: TypeError: pick is undefined",
  );
  await expectSettledViews(session, watched);
  expect(turns.pending()).toEqual([]);

  const traced = waterfall(trace);

  expect(traced.rows.filter((row) => row.name === "canvas.compile")).toHaveLength(3);

  await savePerturbation("canvas-compile-error", [traced], {
    perturbation:
      "Canvas compile error: a syntax error, then a good canvas, then a replace with an import the sandbox lacks; then a client reports a render error",
    expected:
      "Each failed compile fails its call with positioned diagnostics the model reads; no broken canvas part; the replaced canvas is untouched; a reported render error reaches the model.",
    observed: `calls ${outcomes.map((outcome) => outcome?.kind).join(", ")}; first error "${broken.message.split("\n")[1]}"; canvas parts ${canvases.length} at version ${canvas.version}; render error in the next request`,
    wallMs: wall,
  });
});
