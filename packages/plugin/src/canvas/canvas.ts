import { attachFile, definePart, followedTrace, traced } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import {
  CANVAS_ENTRY,
  CANVAS_MAX_HEIGHT,
  CANVAS_MIN_HEIGHT_HINT,
  CANVAS_SOURCE_LIMIT,
  KIT_SPECIFIER,
  LIBRARY_VERSIONS,
  REACT_DOM_EXPORTS,
} from "./canvas-protocol.ts";
import { compileCanvas } from "./canvas-compile.ts";
import { CANVAS_PREVIEW_WIDTHS, describeCanvasPreview } from "./canvas-preview.ts";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewReport,
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
    const drawn = {
      runtime: input.runtime,
      title: input.title,
      height: input.height,
      heights: input.heights ?? [],
    };

    const outcome = await context.part.update((current) => ({
      ...drawn,
      code: input.code,
      error: null,
      revisions: [
        ...current.revisions,
        {
          number: (current.revisions.at(-1)?.number ?? 0) + 1,
          blob: input.blob,
          ...drawn,
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
  description: `${CANVAS_ENTRY}, the entry module.`,
});

const files = Type.Optional(
  Type.Record(Type.String(), Type.String({ maxLength: CANVAS_SOURCE_LIMIT }), {
    description: "Other modules by path (`chart.tsx`), imported as `./chart`.",
  }),
);

const parameters = standard(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: 120, description: "Shown above the canvas." }),
    source,
    files,
    canvas: Type.Optional(
      Type.String({
        description: "The id of a canvas to replace in place.",
      }),
    ),
    height: Type.Optional(
      Type.Number({
        minimum: CANVAS_MIN_HEIGHT_HINT,
        maximum: CANVAS_MAX_HEIGHT,
        description: "Initial height in px.",
      }),
    ),
  }),
);

/** Each library family once: the compiler names every module of a family when an import misses. */
const libraryFamilies = [
  ...new Set(
    Object.keys(LIBRARY_VERSIONS).map((name) =>
      name.includes("/")
        ? `${name.slice(0, name.indexOf("/"))}/*`
        : name.replace(/-[a-z]+$/u, "-*"),
    ),
  ),
];

/**
 * The kit by what a canvas uses it for, with the props a model gets wrong when it guesses. Every
 * export in `KIT` appears here once; the compiler rejects an import the kit doesn't export.
 */
const KIT_GUIDE = [
  'Layout: Stack {direction, gap 0-6, align, justify, wrap}, Grid {columns | "auto", minWidth, gap}, Card {title, description, padding}, Section {title, description}, Panes {areas: string[], rows} with Pane {area, title, height}, Divider',
  'Text: Heading {level}, Text {size, tone: "primary" | "secondary" | "tertiary", weight, mono}, Code {block}, FileLink {path, line}, Badge {tone}, Callout {tone, title}, Kbd {keys}',
  "Facts: Stat {label, value, detail, delta, trend: number[]}, KeyValue {items: {label, value}[]}, Table {columns: {key, label, align}[], rows: {[key]: node}[]}, Meter {value, max, label}, Delta {value}, DiffStat {added, removed}, Steps {items: {title, body, status}[]}, Tracker {label, data: {tone, label}[]}",
  'Charts; yFormat, valueFormat and format are functions (n) => string that carry units: LineChart {series: {id, data: {x, y}[]}[], yFormat, area}, BarChart {data: object[], keys: string[], indexBy, layout: "vertical" | "horizontal", mode: "grouped" | "stacked", valueFormat}, PieChart {data: {id, value}[], donut} for up to 5 parts, BarList {data: {label, value}[], format}, StackedBars {label, series: {key, label, tint}[], buckets: {key, label, values}[], format}, Sparkline {values}',
  "Controls: Button, Tabs, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, ToggleGroup, Toggle, Switch, Checkbox, Slider, Tooltip, TooltipTrigger, TooltipContent, Collapsible, Spinner. useNivoTheme() gives a @nivo chart its {theme, colors}; useColorScheme()",
  'Other tone props: "neutral" | "info" | "success" | "warning" | "danger". tint: a colour name such as "blue" or "green".',
].join("\n");

/** When to draw, in the system prompt: a tool description says how, and models read it only once they have chosen the tool. */
export const CANVAS_PROMPT = {
  id: "canvas",
  order: 50,
  text: "When an answer rests on numbers, a trend, a breakdown or a comparison, show it with canvas_render, then sum it up in a sentence or two without repeating what the canvas shows. A single number or a short answer needs no canvas.",
};

export const CANVAS_DESCRIPTION = [
  "Show the user a chart, table, dashboard or diagram inline in the chat.",
  `\`source\` is a TSX module whose default export is a React component; split a large one into \`files\`. Imports: \`react\`, \`react-dom\` (${REACT_DOM_EXPORTS.join(", ")}), \`${KIT_SPECIFIER}\`, your own files and ${libraryFamilies.map((name) => `\`${name}\``).join(", ")}. No network.`,
  `It is ${CANVAS_PREVIEW_WIDTHS.chat} px wide, ${CANVAS_PREVIEW_WIDTHS.phone} on a phone, and grows to ${CANVAS_MAX_HEIGHT} px tall; give an SVG or a @nivo chart's box a fixed pixel height. Take every colour, font and space from the kit, never a literal value.`,
  `\`${KIT_SPECIFIER}\`:`,
  KIT_GUIDE,
].join("\n");

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

type MeasuredPreview = {
  readonly digest: string;
  readonly heights: NonNullable<CanvasState["heights"]>;
};

type Previews = Map<SessionId, MeasuredPreview>;

const PREVIEWS_KEPT = 64;

function rememberPreview(previews: Previews, session: SessionId, preview: MeasuredPreview): void {
  previews.delete(session);
  previews.set(session, preview);

  if (previews.size <= PREVIEWS_KEPT) return;
  const oldest = previews.keys().next().value;

  if (oldest !== undefined) previews.delete(oldest);
}

type Measuring = { readonly preview: CanvasPreviewer; readonly previews: Previews };

const MEASURE_TIMEOUT_MS = 10_000;

function previewHeights(report: CanvasPreviewReport): MeasuredPreview["heights"] {
  if (report.errors.length > 0) return [];

  return (["chat", "phone"] as const).flatMap((name) => {
    const height = report.heights[name];

    return height > 0 ? [{ width: CANVAS_PREVIEW_WIDTHS[name], height }] : [];
  });
}

async function measureCanvas(
  measuring: Measuring | undefined,
  module: CanvasPreviewRequest["module"],
  invocation: ToolInvocation,
): Promise<MeasuredPreview["heights"]> {
  if (measuring === undefined) return [];
  const previewed = measuring.previews.get(invocation.session.id);

  if (previewed !== undefined && previewed.digest === (await digestCode(module.code)))
    return previewed.heights;

  const outcome = await previewWithin(
    measuring.preview,
    { module, theme: "light" },
    invocation.signal,
    MEASURE_TIMEOUT_MS,
  );

  return outcome.kind === "rendered" ? previewHeights(outcome.report) : [];
}

async function digestCode(code: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(code));

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const PREVIEW_FIRST =
  "Before rendering, call `canvas_preview` with the same `source` and `files`: it shows you the canvas and its errors, console and height without the user seeing it. Fix what it shows, then render once.";

function renderTool(measuring: Measuring | undefined): ToolDefinition<Infer<typeof parameters>> {
  return {
    name: CANVAS_RENDER_TOOL,
    description:
      measuring === undefined ? CANVAS_DESCRIPTION : `${PREVIEW_FIRST}\n\n${CANVAS_DESCRIPTION}`,
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

      const drawn = {
        runtime: compiled.runtime,
        title: args.title,
        height: args.height ?? null,
        heights: await measureCanvas(
          measuring,
          { runtime: compiled.runtime, code: compiled.code, title: args.title },
          invocation,
        ),
      };

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

const PREVIEW_TIMEOUT_MS = 45_000;

async function previewWithin(
  preview: CanvasPreviewer,
  request: CanvasPreviewRequest,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<CanvasPreviewOutcome> {
  signal.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
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
    reason: `The preview took longer than ${timeoutMs / 1000} seconds.`,
  };
}

function previewTool(measuring: Measuring): ToolDefinition<Infer<typeof previewParameters>> {
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
        measuring.preview,
        {
          module: { runtime: compiled.runtime, code: compiled.code, title: "Preview" },
          theme: args.theme ?? "light",
        },
        invocation.signal,
        PREVIEW_TIMEOUT_MS,
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

      const heights = previewHeights(outcome.report);

      if (heights.length > 0)
        rememberPreview(measuring.previews, invocation.session.id, {
          digest: await digestCode(compiled.code),
          heights,
        });

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

export function canvasPlugin(preview?: CanvasPreviewer): Plugin {
  if (preview === undefined)
    return {
      id: "canvas",
      contribute: { parts: [canvas], tools: [renderTool(undefined)], prompt: [CANVAS_PROMPT] },
    };
  const measuring: Measuring = { preview, previews: new Map() };

  return {
    id: "canvas",
    contribute: {
      parts: [canvas],
      tools: [renderTool(measuring), previewTool(measuring)],
      prompt: [CANVAS_PROMPT],
    },
  };
}

export default canvasPlugin();
