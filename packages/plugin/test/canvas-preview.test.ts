import { isPart } from "@nyte-ai/core";
import { expect, it, vi } from "vitest";
import { canvas, canvasPlugin } from "../src/canvas/canvas.ts";
import { CANVAS_PREVIEW_WIDTHS, runCanvasPreview } from "../src/canvas/canvas-preview.ts";
import type {
  CanvasPreviewPage,
  CanvasPreviewReport,
  CanvasPreviewRequest,
} from "../src/canvas/canvas-preview.ts";
import { KIT_SPECIFIER } from "../src/canvas/canvas-protocol.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";

const source = `import { Text } from "${KIT_SPECIFIER}";\nexport default () => <Text>Hi</Text>;`;

const PNG = Uint8Array.fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
);

const report: CanvasPreviewReport = {
  png: PNG,
  heights: { chat: 312, phone: 2400 },
  errors: [{ phase: "render", message: "TypeError: x is undefined (chart.tsx:4:9)", stack: null }],
  console: [{ level: "warn", text: "three: low precision" }],
};

it("drives a shell page: installs the harness once the shell runs, captures at the chat width, then measures a phone", async () => {
  const heights = [300, 312, 640];
  let starts = 0;
  let width = 0;
  let captured = 0;
  const page: CanvasPreviewPage = {
    async evaluate(expression) {
      if (expression.startsWith("globalThis.__nytePreview.settle"))
        return {
          height: heights.shift() ?? 0,
          errors: [],
          console: [{ level: "log", text: "hi" }],
        };
      starts += 1;

      expect(expression).toContain('"method":"nyte/notifications/render"');

      return starts > 1;
    },
    async resize(next) {
      width = next;
    },
    async capture() {
      captured = width;

      return PNG;
    },
  };
  const request: CanvasPreviewRequest = {
    module: { runtime: 2, code: "export default () => null;", title: "Preview" },
    theme: "dark",
  };

  expect(await runCanvasPreview(page, request)).toEqual({
    png: PNG,
    heights: { chat: 312, phone: 640 },
    errors: [],
    console: [{ level: "log", text: "hi" }],
  });
  expect(captured).toBe(CANVAS_PREVIEW_WIDTHS.chat);
});

it("previews through the host's previewer and answers with the screenshot, heights, errors and console, adding nothing to the chat", async () => {
  const fake = fakeModels([testModel("test-model", { input: ["text", "image"] })]);
  const seen: CanvasPreviewRequest[] = [];

  fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "p1",
          name: "canvas_preview",
          arguments: { source, theme: "dark" },
        },
      ],
    },
    { content: [{ type: "text", text: "Looks right." }] },
  );

  await using host = await open(fake, [
    canvasPlugin(async (request) => {
      seen.push(request);

      return { kind: "rendered", report };
    }),
  ]);
  const { session, receipt } = await host.sessions.start({ content: "Preview it." });
  await receipt.settled();

  expect(seen).toHaveLength(1);
  expect(seen[0]?.theme).toBe("dark");
  expect(seen[0]?.module.code).toContain("var _canvas = require('nyte/canvas');");
  expect((await session.view()).messages.filter((message) => isPart(message, canvas))).toEqual([]);
  const result = fake.requests
    .at(-1)
    ?.context.messages.find((message) => message.role === "toolResult");

  expect(result).toMatchObject({
    isError: false,
    content: [
      {
        type: "text",
        text: [
          "Preview only; the user has not seen it. The screenshot is the chat-column render.",
          "At 808 px wide (the chat column) it is 312 px tall.",
          "At 358 px wide (a phone) it is 2400 px tall, so it scrolls past 2000 px.",
          "Errors (1):",
          "- render: TypeError: x is undefined (chart.tsx:4:9)",
          "Console (1):",
          "- [warn] three: low precision",
        ].join("\n"),
      },
      { type: "image", mimeType: "image/png", data: PNG.toBase64() },
    ],
  });
});

it("says when this host has no preview, and offers the tool only to a host with a previewer", async () => {
  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "toolCall", id: "p1", name: "canvas_preview", arguments: { source } }] },
    { content: [{ type: "text", text: "Rendering instead." }] },
  );

  await using host = await open(fake, [
    canvasPlugin(async () => ({ kind: "unavailable", reason: "No Chrome or Chromium was found." })),
  ]);
  const { receipt } = await host.sessions.start({ content: "Preview it." });
  await receipt.settled();

  expect(
    JSON.stringify(
      fake.requests.at(-1)?.context.messages.find((message) => message.role === "toolResult"),
    ),
  ).toContain(
    "No preview here: No Chrome or Chromium was found. Render with canvas_render; an error it hits comes back in the canvas next turn.",
  );

  const plain = canvasPlugin().contribute?.tools ?? [];
  const previewing = canvasPlugin(async () => ({ kind: "unavailable", reason: "" })).contribute
    ?.tools;

  expect(plain.map((tool) => tool.name)).toEqual(["canvas_render"]);
  expect(plain[0]?.description).not.toContain("canvas_preview");
  expect(previewing?.map((tool) => tool.name)).toEqual(["canvas_render", "canvas_preview"]);
  expect(previewing?.[0]?.description).toMatch(/^Before rendering, call `canvas_preview`/);
});

it("aborts a preview that runs past 45 seconds and tells the model it took too long", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fake = fakeModels();
  const started = Promise.withResolvers<AbortSignal>();

  fake.reply(
    { content: [{ type: "toolCall", id: "p1", name: "canvas_preview", arguments: { source } }] },
    { content: [{ type: "text", text: "Rendering instead." }] },
  );

  try {
    await using host = await open(fake, [
      canvasPlugin((_request, signal) => {
        started.resolve(signal);

        return new Promise(() => undefined);
      }),
    ]);
    const { receipt: turn } = await host.sessions.start({ content: "Preview it." });
    const signal = await started.promise;
    await vi.advanceTimersByTimeAsync(45_000);
    await turn.settled();

    expect(signal.aborted).toBe(true);
    expect(
      JSON.stringify(
        fake.requests.at(-1)?.context.messages.find((message) => message.role === "toolResult"),
      ),
    ).toContain("No preview here: The preview took longer than 45 seconds.");
  } finally {
    vi.useRealTimers();
  }
});
