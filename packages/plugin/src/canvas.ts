import { definePart } from "@nyte-ai/core";
import type { ActionContext, ActionOutput, ToolDefinition } from "@nyte-ai/core";
import { asId, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

const shape = Type.Object({
  kind: Type.Union([Type.Literal("rect"), Type.Literal("ellipse"), Type.Literal("line"), Type.Literal("text")]),
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
  label: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
});

const state = standard(Type.Object({ shapes: Type.Array(shape) }));

const actions = { draw: { input: standard(Type.Object({ shapes: Type.Array(shape) })) } };

type Actions = typeof actions;

/**
 * Returns one shape on a canvas, in canvas units from the top left.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Shape = Infer<typeof state>["shapes"][number];

const handlers: {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<Infer<typeof state>, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
} = {
  async draw(input, context) {
    const outcome = await context.part.update((current) => ({ shapes: [...current.shapes, ...input.shapes] }));

    if (outcome.kind !== "updated") throw new Error(`The canvas could not be drawn on: ${outcome.kind}.`);
  },
};

/**
 * A canvas part: shapes a renderer draws, with a `draw` action that adds
 * more. A person draws through the action; the model through
 * `canvas_draw`, which calls the same action.
 *
 * @category plugins
 * @since 0.1.0
 */
export const canvas = definePart({
  kind: "canvas",
  state,
  actions,
  fallback: (current, { id }) =>
    `Canvas ${id} with ${current.shapes.length} shape${current.shapes.length === 1 ? "" : "s"}${current.shapes.some((item) => item.label !== undefined) ? `: ${current.shapes.flatMap((item) => (item.label === undefined ? [] : [item.label])).join(", ")}` : ""}.`,
  onAction: (action, input, context) => handlers[action](input, context),
});

const parameters = standard(
  Type.Object({
    canvas: Type.Optional(Type.String({ description: "The id of a canvas to add to; omit to start a new one." })),
    shapes: Type.Array(shape, { minItems: 1 }),
  }),
);

const draw: ToolDefinition<Infer<typeof parameters>> = {
  name: "canvas_draw",
  description: "Draw shapes for the user: start a canvas, or add to one by its id. Coordinates are canvas units from the top left.",
  parameters,
  class: (args) => ({ kind: "custom", label: args.canvas === undefined ? "Drawing a canvas" : `Drawing on ${args.canvas}` }),
  replay: "never",
  async execute(args, invocation) {
    if (args.canvas === undefined) {
      const part = await invocation.session.parts.create(canvas, { state: { shapes: args.shapes }, placement: { kind: "panel" } });

      return { content: [{ kind: "text", text: `Drew canvas ${part.id}.` }], parts: [part.id] };
    }

    const outcome = await invocation.session.part(asId(args.canvas)).act("draw", { shapes: args.shapes });

    if (outcome.kind !== "ok") throw new Error(`Canvas ${args.canvas} was not drawn on: ${outcome.kind}.`);

    return { content: [{ kind: "text", text: `Drew on canvas ${args.canvas}.` }], parts: [asId(args.canvas)] };
  },
};

/**
 * Lets the model draw for the user on a `canvas` part, and a client let the
 * user draw on it through the part's `draw` action.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "canvas",
  contribute: { parts: [canvas], tools: [draw] },
} satisfies Plugin;
