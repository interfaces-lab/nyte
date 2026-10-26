import { definePart } from "@nyte-ai/core";
import { idSchema, standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import { CANVAS_CODE_LIMIT } from "./canvas-protocol.ts";

/**
 * The tool that renders a canvas and replaces one in place.
 *
 * @category plugins
 * @since 0.1.0
 */
export const CANVAS_RENDER_TOOL = "canvas_render";

/**
 * How many revisions a canvas lists; a replace past it drops the oldest.
 *
 * @category plugins
 * @since 0.1.0
 */
export const CANVAS_REVISIONS_KEPT = 50;

const drawn = {
  runtime: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  height: Type.Union([Type.Number(), Type.Null()]),
};

const revision = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  blob: idSchema<"blob">(),
  ...drawn,
  at: Type.Number(),
});

const state = standard(
  Type.Object({
    ...drawn,
    code: Type.String({ maxLength: CANVAS_CODE_LIMIT }),
    error: Type.Union([Type.String(), Type.Null()]),
    revisions: Type.Array(revision, { minItems: 1, maxItems: CANVAS_REVISIONS_KEPT }),
  }),
);

const actions = {
  replace: {
    input: standard(
      Type.Object({
        ...drawn,
        code: Type.String({ maxLength: CANVAS_CODE_LIMIT }),
        blob: idSchema<"blob">(),
      }),
    ),
  },
  report: {
    input: standard(Type.Object({ message: Type.String({ minLength: 1, maxLength: 2000 }) })),
  },
};

/**
 * Returns a canvas part's state: the compiled module, the runtime it needs,
 * its title, the agent's height hint, the last error a client reported, and
 * its revisions, oldest first, the last one being the module itself.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasState = Infer<typeof state>;

/**
 * One revision of a canvas: its compiled module stored as a blob, with what
 * drawing it needs besides the code.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasRevision = CanvasState["revisions"][number];

/**
 * A canvas part: a React module the agent wrote, compiled on the host and
 * drawn by a client inside the sandboxed runtime shell. `replace` swaps the
 * module in place and lists it as the next revision; `report` records a load
 * or render error a client saw, which the model reads in the fallback.
 *
 * @category plugins
 * @since 0.1.0
 */
export const canvas = definePart({
  kind: "canvas",
  state,
  actions,
  fallback: (current, { id }) =>
    `Canvas ${id}: ${current.title}.${current.error === null ? "" : ` It failed to render: ${current.error}. Fix it by calling canvas_render with canvas "${id}".`}`,
});
