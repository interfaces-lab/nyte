import { definePart } from "@nyte-ai/core";
import { idSchema, standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import { CANVAS_CODE_LIMIT } from "./canvas-protocol.ts";

export const CANVAS_RENDER_TOOL = "canvas_render";

export const CANVAS_REVISIONS_KEPT = 50;

const drawn = {
  runtime: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  height: Type.Union([Type.Number(), Type.Null()]),
  heights: Type.Optional(
    Type.Array(
      Type.Object({ width: Type.Integer({ minimum: 1 }), height: Type.Number({ minimum: 0 }) }),
      { maxItems: 8 },
    ),
  ),
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

export type CanvasState = Infer<typeof state>;

export type CanvasRevision = CanvasState["revisions"][number];

export const canvas = definePart({
  kind: "canvas",
  state,
  actions,
  fallback: (current, { id }) =>
    `Canvas ${id}: ${current.title}.${current.error === null ? "" : ` It failed to render: ${current.error}. Fix it by calling canvas_render with canvas "${id}".`}`,
});
