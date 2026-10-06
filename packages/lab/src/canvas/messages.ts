import { Type } from "typebox";

const CanvasVariablesSchema = Type.Object({
  "--canvas-fg": Type.String(),
  "--canvas-muted": Type.String(),
  "--canvas-subtle": Type.String(),
  "--canvas-grid": Type.String(),
  "--canvas-border": Type.String(),
  "--canvas-surface": Type.String(),
  "--canvas-font": Type.String(),
  "--canvas-font-size": Type.String(),
  "--canvas-chart-1": Type.String(),
  "--canvas-chart-2": Type.String(),
  "--canvas-chart-3": Type.String(),
  "--canvas-chart-4": Type.String(),
  "--canvas-chart-5": Type.String(),
  "--canvas-chart-6": Type.String(),
});

export const CanvasThemeSchema = Type.Object({
  scheme: Type.String({ pattern: "^[a-z ]{1,32}$" }),
  variables: CanvasVariablesSchema,
});

export const FrameMessageSchema = Type.Union([
  Type.Object({ kind: Type.Literal("canvas:ready") }),
  Type.Object({
    kind: Type.Literal("canvas:height"),
    height: Type.Number({ minimum: 0, maximum: 10_000 }),
  }),
  Type.Object({ kind: Type.Literal("canvas:error"), message: Type.String({ maxLength: 10_000 }) }),
]);

export const HostMessageSchema = Type.Union([
  Type.Object({ kind: Type.Literal("canvas:hello") }),
  Type.Object({
    kind: Type.Literal("canvas:mount"),
    theme: CanvasThemeSchema,
    code: Type.Optional(Type.String()),
  }),
]);
