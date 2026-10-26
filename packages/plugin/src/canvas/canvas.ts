import { attachFile, definePart, followedTrace, traced } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import {
  CANVAS_ENTRY,
  CANVAS_MAX_HEIGHT,
  CANVAS_MIN_HEIGHT_HINT,
  CANVAS_SOURCE_LIMIT,
  KIT,
  KIT_SPECIFIER,
  LIBRARY_VERSIONS,
  REACT_DOM_EXPORTS,
  TINTS,
} from "./canvas-protocol.ts";
import { compileCanvas } from "./canvas-compile.ts";
import { CANVAS_PREVIEW_WIDTHS, describeCanvasPreview } from "./canvas-preview.ts";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewRequest,
  CanvasPreviewer,
} from "./canvas-preview.ts";
import type { CompileError } from "./canvas-compile.ts";
import type { Plugin } from "@nyte-ai/plugin/core";
import { CANVAS_RENDER_TOOL, CANVAS_REVISIONS_KEPT, canvas as canvasContract } from "./schema.ts";
import type { CanvasState } from "./schema.ts";

type Actions = typeof canvasContract.actions;

const handlers: {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<CanvasState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
} = {
  async replace(input, context) {
    const outcome = await context.part.update((current) => ({
      runtime: input.runtime,
      title: input.title,
      code: input.code,
      height: input.height,
      error: null,
      revisions: [
        ...current.revisions,
        {
          number: (current.revisions.at(-1)?.number ?? 0) + 1,
          blob: input.blob,
          runtime: input.runtime,
          title: input.title,
          height: input.height,
          at: Date.now(),
        },
      ].slice(-CANVAS_REVISIONS_KEPT),
    }));

    if (outcome.kind !== "updated")
      throw new Error(`The canvas could not be replaced: ${outcome.kind}.`);
  },
  async report(input, context) {
    const outcome = await context.part.update((current) => ({ ...current, error: input.message }));

    if (outcome.kind !== "updated")
      throw new Error(`The canvas error could not be reported: ${outcome.kind}.`);
  },
};

export const canvas = definePart({
  ...canvasContract,
  onAction: (action, input, context) => handlers[action](input, context),
});

const source = Type.String({
  maxLength: CANVAS_SOURCE_LIMIT,
  description: `${CANVAS_ENTRY}: the TSX module whose default export is the component.`,
});

const files = Type.Optional(
  Type.Record(Type.String(), Type.String({ maxLength: CANVAS_SOURCE_LIMIT }), {
    description: `The canvas's other modules, keyed by path from ${CANVAS_ENTRY}'s folder (\`chart.tsx\`, \`lib/scale.ts\`), which it imports as \`./chart\` or \`./lib/scale.ts\`.`,
  }),
);

const parameters = standard(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: 120, description: "Shown above the canvas." }),
    source,
    files,
    canvas: Type.Optional(
      Type.String({
        description: "The id of a canvas to replace in place; omit to add a new one.",
      }),
    ),
    height: Type.Optional(
      Type.Number({
        minimum: CANVAS_MIN_HEIGHT_HINT,
        maximum: CANVAS_MAX_HEIGHT,
        description: "Initial frame height in px until the canvas reports its own.",
      }),
    ),
  }),
);

const kitReference = Object.entries(KIT)
  .map(([name, signature]) => `- ${name} ${signature}`)
  .join("\n");

/**
 * What the model reads about the tool and the kit; the signatures come from
 * `KIT`, so they cannot drift from what the compiler accepts.
 *
 * @category plugins
 * @since 0.1.0
 */
export const CANVAS_DESCRIPTION = [
  `Render a React canvas inline in the chat. \`source\` is ${CANVAS_ENTRY}, a TSX module whose default export is a component; split a large canvas into \`files\` it imports by relative path. Every file counts toward one ${Math.round(CANVAS_SOURCE_LIMIT / 1024)} KB budget.`,
  `Imports: \`react\`, \`react-dom\` (${REACT_DOM_EXPORTS.map((name) => `\`${name}\``).join(" and ")} only), \`${KIT_SPECIFIER}\`, the canvas's own files, and these libraries, each loaded only by a canvas that imports it: ${Object.entries(
    LIBRARY_VERSIONS,
  )
    .map(([name, version]) => `\`${name}\` ${version}`)
    .join(
      ", ",
    )}. \`three\` is the core module without its addons, so orbit a camera yourself. Nothing else resolves (no other npm packages, no URLs, no fetch). \`eval\` and \`new Function\` are unavailable at run time.`,
  `The canvas runs sandboxed with no network, sized to its content (up to ${CANVAS_MAX_HEIGHT} px, then it scrolls), on the chat's background with the user's theme applied through the kit.`,
  "Use the kit for layout, text, data and charts; never hard-code colours, fonts or backgrounds. An `<a href>` to an http(s) URL opens in the user's browser, and one to a workspace path such as `src/app.ts:42` opens that file at that line; other schemes are refused. Pass `canvas` to replace an earlier canvas in place.",
  "",
  'Charts: `StackedBars` and `Sparkline` are compact and axis-free, for a figure that sits beside its own number (a Stat, a Table row); use them first. `LineChart`, `BarChart` and `PieChart` are full charts with axes, gridlines and a readout, for a series that needs reading on its own: a line for change over time, bars to compare categories (`layout="horizontal"` when the labels are long), a pie only for up to five parts of one whole. All of them share one look and fit the width they get; give each series a `tint` only when a hue carries meaning (green for good, red for bad), or leave the order to the kit, which keeps neighbouring series apart for colour-blind readers.',
  'Keep a chart to one value axis and at most eight series; fold the rest into an "Other" series, and put measures on different scales in separate charts. Pass `yFormat` or `valueFormat` to carry units (`$`, `%`, `ms`); the axis, readout and pie legend all use it. An empty series or data array draws a "No data" box, so render the chart as it is rather than guarding it.',
  `Tint = ${TINTS.map((tint) => `"${tint}"`).join(" | ")}.`,
  "",
  `\`${KIT_SPECIFIER}\` exports:`,
  kitReference,
].join("\n");

/** Returns the diagnostics as the model reads them: one per line, positioned in their file when the compiler knows where. */
function describeErrors(errors: readonly CompileError[]): string {
  return errors
    .map((error) => {
      if (error.file === null) return error.text;

      return error.line === null
        ? `${error.file}: ${error.text}`
        : `${error.file}:${error.line}:${error.column ?? 0} ${error.text}`;
    })
    .join("\n");
}

const encoder = new TextEncoder();

/** Compiles a tool call's canvas, or throws the diagnostics for the model to fix. */
async function compile(
  args: { readonly source: string; readonly files?: Readonly<Record<string, string>> },
  invocation: ToolInvocation,
) {
  const compiled = await traced(
    "canvas.compile",
    followedTrace(invocation.session.id),
    {
      bytes: [args.source, ...Object.values(args.files ?? {})].reduce(
        (sum, text) => sum + encoder.encode(text).byteLength,
        0,
      ),
      files: Object.keys(args.files ?? {}).length,
    },
    () => compileCanvas(args.source, args.files),
  );

  if (compiled.kind === "failed")
    throw new Error(`The canvas did not compile:\n${describeErrors(compiled.errors)}`);

  return compiled;
}

const PREVIEW_FIRST =
  "Before rendering, call `canvas_preview` with the same `source` and `files`: it shows you the canvas and its errors, console and height without the user seeing it. Fix what it shows, then render once.";

function renderTool(previewing: boolean): ToolDefinition<Infer<typeof parameters>> {
  return {
    name: CANVAS_RENDER_TOOL,
    description: previewing ? `${PREVIEW_FIRST}\n\n${CANVAS_DESCRIPTION}` : CANVAS_DESCRIPTION,
    parameters,
    class: (args) => ({
      kind: "custom",
      label: args.canvas === undefined ? `Rendering ${args.title}` : `Updating ${args.title}`,
    }),
    effects: "none",
    approval: "never",
    replay: "safe",
    async execute(args, invocation) {
      const compiled = await compile(args, invocation);
      const drawn = { runtime: compiled.runtime, title: args.title, height: args.height ?? null };

      const blob = await invocation.env.files.upload(
        (async function* () {
          yield encoder.encode(compiled.code);
        })(),
      );

      if (args.canvas === undefined) {
        const part = await invocation.session.parts.create(canvas, {
          state: {
            ...drawn,
            code: compiled.code,
            error: null,
            revisions: [{ number: 1, blob, ...drawn, at: Date.now() }],
          },
          placement: { kind: "transcript", role: "answer" },
        });

        return {
          content: [{ kind: "text", text: `Rendered canvas ${part.id}: ${args.title}.` }],
          parts: [part.id],
        };
      }

      const outcome = await invocation.session
        .part(asId(args.canvas))
        .act("replace", { ...drawn, code: compiled.code, blob });

      if (outcome.kind !== "ok")
        throw new Error(`Canvas ${args.canvas} was not replaced: ${outcome.kind}.`);

      return {
        content: [{ kind: "text", text: `Replaced canvas ${args.canvas}: ${args.title}.` }],
        parts: [asId(args.canvas)],
      };
    },
  };
}

const previewParameters = standard(
  Type.Object({
    source,
    files,
    theme: Type.Optional(
      Type.Union([Type.Literal("light"), Type.Literal("dark")], {
        description: "The theme to preview in; default light.",
      }),
    ),
  }),
);

/** How long a preview may take, from the call to its report. */
const PREVIEW_TIMEOUT_MS = 45_000;

/** Runs one preview, aborting the previewer's signal and answering unavailable past the timeout; it throws when the turn stops first. */
async function previewWithin(
  preview: CanvasPreviewer,
  request: CanvasPreviewRequest,
  signal: AbortSignal,
): Promise<CanvasPreviewOutcome> {
  signal.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), PREVIEW_TIMEOUT_MS);
  const stop = AbortSignal.any([signal, deadline.signal]);
  const stopped = new Promise<"stopped">((resolve) =>
    stop.addEventListener("abort", () => resolve("stopped"), { once: true }),
  );

  try {
    const outcome = await Promise.race([preview(request, stop), stopped]);

    if (outcome !== "stopped") return outcome;
  } finally {
    clearTimeout(timer);
  }
  signal.throwIfAborted();

  return {
    kind: "unavailable",
    reason: `The preview took longer than ${PREVIEW_TIMEOUT_MS / 1000} seconds.`,
  };
}

function previewTool(preview: CanvasPreviewer): ToolDefinition<Infer<typeof previewParameters>> {
  return {
    name: "canvas_preview",
    description: `Render a canvas off-screen in the real canvas runtime and see it before the user does: a PNG at the chat column's width (${CANVAS_PREVIEW_WIDTHS.chat} px), its height there and at a phone's width (${CANVAS_PREVIEW_WIDTHS.phone} px), every load or render error with its file and line, and the canvas's console output. Takes the same \`source\` and \`files\` as canvas_render and compiles them the same way; nothing is added to the chat.`,
    parameters: previewParameters,
    class: () => ({ kind: "custom", label: "Previewing canvas" }),
    effects: "none",
    approval: "never",
    replay: "safe",
    async execute(args, invocation) {
      const compiled = await compile(args, invocation);
      const outcome = await previewWithin(
        preview,
        {
          module: { runtime: compiled.runtime, code: compiled.code, title: "Preview" },
          theme: args.theme ?? "light",
        },
        invocation.signal,
      );

      if (outcome.kind === "unavailable")
        return {
          content: [
            {
              kind: "text",
              text: `No preview here: ${outcome.reason} Render with canvas_render; an error it hits comes back in the canvas next turn.`,
            },
          ],
        };
      const { png } = outcome.report;

      return {
        content: [
          { kind: "text", text: describeCanvasPreview(outcome.report) },
          await attachFile(
            invocation.env.files,
            (async function* () {
              yield png;
            })(),
            { mime: "image/png" },
          ),
        ],
      };
    },
  };
}

/**
 * Returns the canvas plugin: the `canvas` part and `canvas_render`, which
 * compiles in-process on any host, plus `canvas_preview` when the host
 * passes a previewer, in which case `canvas_render` tells the model to
 * preview first.
 *
 * @category plugins
 * @since 0.1.0
 */
export function canvasPlugin(preview?: CanvasPreviewer): Plugin {
  return {
    id: "canvas",
    contribute: {
      parts: [canvas],
      tools: preview === undefined ? [renderTool(false)] : [renderTool(true), previewTool(preview)],
    },
  };
}

/**
 * The canvas plugin without a previewer, as a host that cannot render one
 * loads it.
 *
 * @category plugins
 * @since 0.1.0
 */
export default canvasPlugin();
