import { Type } from "typebox";

export const MarkdownCase = Type.Object({
  variant: Type.Union([Type.Literal("prose"), Type.Literal("streamdown")]),
});

export const MarkdownResult = Type.Array(
  Type.Object({
    fixture: Type.String(),
    updates: Type.Number(),
    runs: Type.Array(
      Type.Object({
        totalMs: Type.Number(),
        scriptMs: Type.Number(),
        layoutMs: Type.Number(),
        p95Ms: Type.Number(),
        elements: Type.Number(),
      }),
    ),
  }),
);

export const DragCase = Type.Object({ panes: Type.Number(), filled: Type.Number() });

export const DragResult = Type.Object({
  moves: Type.Number(),
  runs: Type.Array(Type.Object({ p50Ms: Type.Number(), p95Ms: Type.Number() })),
});

export const StreamingCase = Type.Object({ streams: Type.Number(), covered: Type.Boolean() });

export const StreamingResult = Type.Object({
  ticks: Type.Number(),
  playbackMs: Type.Number(),
  frames: Type.Number(),
  p50Ms: Type.Number(),
  p95Ms: Type.Number(),
  p99Ms: Type.Number(),
  maxMs: Type.Number(),
  longTasks: Type.Union([
    Type.Null(),
    Type.Object({ count: Type.Number(), totalMs: Type.Number() }),
  ]),
});
