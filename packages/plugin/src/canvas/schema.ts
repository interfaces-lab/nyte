import { definePart } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import { CANVAS_CODE_LIMIT } from "./canvas-protocol.ts";

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

/**
 * Returns a canvas part's state: the compiled module, the runtime it needs,
 * its title, the agent's height hint and the last error a client reported.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasState = Infer<typeof state>;

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
});
