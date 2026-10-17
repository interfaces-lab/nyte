import { isPart } from "@nyte-ai/core";
import { expect, it } from "vitest";
import canvasPlugin, { CANVAS_DESCRIPTION, canvas } from "../src/canvas/canvas.ts";
import { KIT_EXPORTS, KIT_SPECIFIER, LIBRARY_EXPORTS } from "../src/canvas/canvas-protocol.ts";
import { fakeModels, open, until } from "./fake-models.ts";

const first = `import { Text } from "${KIT_SPECIFIER}";\nexport default () => <Text>1</Text>;`;

const second = `import { Text } from "${KIT_SPECIFIER}";\nexport default () => <Text>2</Text>;`;

it("renders a canvas from the tool as an answer part, then replaces it in place and takes a client's error report", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "r1",
          name: "canvas_render",
          arguments: { title: "Totals", source: first, height: 120 },
        },
      ],
    },
    { content: [{ type: "text", text: "Rendered." }] },
  );

  await using host = await open(fake, [canvasPlugin]);
  const { session, receipt: started } = await host.sessions.start({
    content: "Show totals.",
  });
  await started.settled();

  const drawn = await until(async () =>
    (await session.view()).messages.find((message) => isPart(message, canvas)),
  );

  expect(drawn).toMatchObject({
    role: "answer",
    state: { runtime: 1, title: "Totals", height: 120, error: null },
  });
  expect(drawn.state.code).toContain("var _canvas = require('nyte/canvas');");
  expect(drawn.state.code).toContain('export default __require("main.tsx").default;');
  expect(
    canvas.fallback(
      { runtime: 1, title: "Totals", code: "", height: null, error: null },
      { id: drawn.part },
    ),
  ).toBe(`Canvas ${drawn.part}: Totals.`);

  expect(
    await session.part(drawn.part).act("report", { message: "View is not a function" }),
  ).toEqual({ kind: "ok", output: undefined });
  expect(
    (await session.view()).messages.find(
      (message) => message.kind === "part" && message.part === drawn.part,
    ),
  ).toMatchObject({ state: { error: "View is not a function" } });
  expect(
    canvas.fallback(
      { runtime: 1, title: "Totals", code: "", height: null, error: "View is not a function" },
      { id: drawn.part },
    ),
  ).toBe(
    `Canvas ${drawn.part}: Totals. It failed to render: View is not a function. Fix it by calling canvas_render with canvas "${drawn.part}".`,
  );

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "r2",
          name: "canvas_render",
          arguments: { title: "Totals by month", source: second, canvas: drawn.part },
        },
      ],
    },
    { content: [{ type: "text", text: "Replaced." }] },
  );
  await (await session.send("By month.")).settled();

  const after = (await session.view()).messages.find(
    (message) => message.kind === "part" && message.part === drawn.part,
  );

  expect(after).toMatchObject({
    state: { title: "Totals by month", height: null, error: null },
    version: 3,
  });
  expect(after !== undefined && isPart(after, canvas) ? after.state.code : "").toContain('"2"');
  expect((await session.view()).messages.filter((message) => isPart(message, canvas))).toHaveLength(
    1,
  );
});

it("answers the model with the compiler's diagnostics, positioned per line, and creates no part", async () => {
  const fake = fakeModels();

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "r1",
          name: "canvas_render",
          arguments: {
            title: "Broken",
            source: `import { Nope } from "${KIT_SPECIFIER}";\nexport const a = <Nope />;`,
          },
        },
      ],
    },
    { content: [{ type: "text", text: "Fixing." }] },
  );

  await using host = await open(fake, [canvasPlugin]);
  const { session, receipt: started } = await host.sessions.start({ content: "Show it." });
  await started.settled();

  const view = await session.view();

  expect(view.messages.filter((message) => isPart(message, canvas))).toEqual([]);
  const result = fake.requests
    .at(-1)
    ?.context.messages.find((message) => message.role === "toolResult");

  expect(JSON.stringify(result)).toContain(
    `The canvas did not compile:\\nmain.tsx:1:0 \\"${KIT_SPECIFIER}\\" has no export named \\"Nope\\".\\nmain.tsx: The module must \`export default\` a component.`,
  );
});

it("describes the tool with every kit export, every import and the libraries", () => {
  expect(CANVAS_DESCRIPTION).toContain(
    `Imports: \`react\`, \`react-dom\` (\`createPortal\` and \`flushSync\` only), \`${KIT_SPECIFIER}\`, the canvas's own files`,
  );

  for (const name of Object.keys(LIBRARY_EXPORTS))
    expect(CANVAS_DESCRIPTION).toContain(`\`${name}\` `);
  expect(CANVAS_DESCRIPTION).toContain("`eval` and `new Function` are unavailable");

  for (const name of KIT_EXPORTS) expect(CANVAS_DESCRIPTION).toContain(`- ${name} `);
});
