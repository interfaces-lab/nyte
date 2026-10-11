import { definePart } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import {
  CANVAS_CODE_LIMIT,
  CANVAS_MAX_HEIGHT,
  CANVAS_MIN_HEIGHT_HINT,
  CANVAS_SOURCE_LIMIT,
  KIT,
  KIT_SPECIFIER,
  TINTS,
} from "./canvas-protocol.ts";
import { compileCanvas } from "./canvas-compile.ts";
import type { CompileError } from "./canvas-compile.ts";
import type { Plugin } from "./core.ts";

export { compileCanvas } from "./canvas-compile.ts";
export type { CompileError, CompileOutcome } from "./canvas-compile.ts";

const state = standard(
  Type.Object({
    runtime: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    code: Type.String({ maxLength: CANVAS_CODE_LIMIT }),
    height: Type.Union([Type.Number(), Type.Null()]),
    error: Type.Union([Type.String(), Type.Null()]),
  }),
);

const actions = {
  replace: {
    input: standard(
      Type.Object({
        runtime: Type.Integer({ minimum: 1 }),
        title: Type.String({ minLength: 1, maxLength: 120 }),
        code: Type.String({ maxLength: CANVAS_CODE_LIMIT }),
        height: Type.Union([Type.Number(), Type.Null()]),
      }),
    ),
  },
  report: {
    input: standard(Type.Object({ message: Type.String({ minLength: 1, maxLength: 2000 }) })),
  },
};

type Actions = typeof actions;

/**
 * Returns a canvas part's state: the compiled module, the runtime it needs,
 * its title, the agent's height hint and the last error a client reported.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasState = Infer<typeof state>;

const handlers: {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<CanvasState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
} = {
  async replace(input, context) {
    const outcome = await context.part.update(() => ({ ...input, error: null }));

    if (outcome.kind !== "updated")
      throw new Error(`The canvas could not be replaced: ${outcome.kind}.`);
  },
  async report(input, context) {
    const outcome = await context.part.update((current) => ({ ...current, error: input.message }));

    if (outcome.kind !== "updated")
      throw new Error(`The canvas error could not be reported: ${outcome.kind}.`);
  },
};

/**
 * A canvas part: a React module the agent wrote, compiled on the host and
 * drawn by a client inside the sandboxed runtime shell. `replace` swaps the
 * module in place; `report` records a load or render error a client saw,
 * which the model reads in the fallback.
 *
 * @category plugins
 * @since 0.1.0
 */
export const canvas = definePart({
  kind: "canvas",
  state,
  actions,
  fallback: (current, { id }) =>
    `Canvas ${id}: ${current.title}.${current.error === null ? "" : ` It failed to render: ${current.error}`}`,
  onAction: (action, input, context) => handlers[action](input, context),
});

const parameters = standard(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: 120, description: "Shown above the canvas." }),
    source: Type.String({
      maxLength: CANVAS_SOURCE_LIMIT,
      description: "One TSX module whose default export is the component.",
    }),
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
  "Render a React canvas inline in the chat. `source` is one TSX module whose default export is a component.",
  `Only two imports exist: \`react\` and \`${KIT_SPECIFIER}\`; nothing else resolves (no npm packages, no URLs, no fetch, no relative files). \`eval\` and \`new Function\` are unavailable at run time.`,
  `The canvas runs sandboxed with no network, sized to its content (up to ${CANVAS_MAX_HEIGHT} px, then it scrolls), on the chat's background with the user's theme applied through the kit.`,
  "Use the kit for layout, text, data and charts; never hard-code colours, fonts or backgrounds. Links to http(s) URLs open in the user's browser. Pass `canvas` to replace an earlier canvas in place.",
  "",
  "Charts: `StackedBars` and `Sparkline` are compact and axis-free, for a figure that sits beside its own number (a Stat, a Table row); use them first. `LineChart`, `BarChart` and `PieChart` are full charts with axes, gridlines and a readout, for a series that needs reading on its own. All of them share one look; give each series a `tint` only when a hue carries meaning, or leave the order to the kit.",
  `Tint = ${TINTS.map((tint) => `"${tint}"`).join(" | ")}.`,
  "",
  `\`${KIT_SPECIFIER}\` exports:`,
  kitReference,
].join("\n");

/** Returns the diagnostics as the model reads them: one per line, positioned when the compiler knows where. */
function describeErrors(errors: readonly CompileError[]): string {
  return errors
    .map((error) =>
      error.line === null
        ? error.text
        : `canvas.tsx:${error.line}:${error.column ?? 0} ${error.text}`,
    )
    .join("\n");
}

const render: ToolDefinition<Infer<typeof parameters>> = {
  name: "canvas_render",
  description: CANVAS_DESCRIPTION,
  parameters,
  class: (args) => ({
    kind: "custom",
    label: args.canvas === undefined ? `Rendering ${args.title}` : `Updating ${args.title}`,
  }),
  replay: "never",
  async execute(args, invocation) {
    const compiled = await compileCanvas(args.source);

    if (compiled.kind === "failed")
      throw new Error(`The canvas did not compile:\n${describeErrors(compiled.errors)}`);
    const next = {
      runtime: compiled.runtime,
      title: args.title,
      code: compiled.code,
      height: args.height ?? null,
    };

    if (args.canvas === undefined) {
      const part = await invocation.session.parts.create(canvas, {
        state: { ...next, error: null },
        placement: { kind: "transcript", role: "answer" },
      });

      return {
        content: [{ kind: "text", text: `Rendered canvas ${part.id}: ${args.title}.` }],
        parts: [part.id],
      };
    }

    const outcome = await invocation.session.part(asId(args.canvas)).act("replace", next);

    if (outcome.kind !== "ok")
      throw new Error(`Canvas ${args.canvas} was not replaced: ${outcome.kind}.`);

    return {
      content: [{ kind: "text", text: `Replaced canvas ${args.canvas}: ${args.title}.` }],
      parts: [asId(args.canvas)],
    };
  },
};

/**
 * The canvas plugin: the `canvas` part and the `canvas_render` tool, which
 * compiles in-process on any host.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "canvas",
  contribute: { parts: [canvas], tools: [render] },
} satisfies Plugin;
