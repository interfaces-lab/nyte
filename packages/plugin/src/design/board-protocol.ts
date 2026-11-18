import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const Offset = Type.Integer({ minimum: 0 });

const SpanType = Type.Object({ path: Type.String(), start: Offset, end: Offset });

/** An element of a design file: its workspace-relative path and its offsets in the file's text, in UTF-16 code units. */
export type Span = Static<typeof SpanType>;

const SubjectType = Type.Union([
  Type.Object({ kind: Type.Literal("file"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("span"), path: Type.String(), start: Offset, end: Offset }),
]);

export type BoardSubject = Static<typeof SubjectType>;

const SheetType = Type.Object({
  path: Type.String(),
  reads: Type.Array(Type.String()),
});

export type BoardSheet = Static<typeof SheetType>;

const FrameFactType = Type.Object({
  key: Type.String(),
  movable: Type.Boolean(),
  pinned: Type.Boolean(),
});

export type FrameFact = Static<typeof FrameFactType>;

const AppMessageType = Type.Union([
  Type.Object({
    kind: Type.Literal("load"),
    code: Type.String(),
    sheets: Type.Array(SheetType),
    styles: Type.Array(Type.Object({ path: Type.String(), text: Type.String() })),
    texts: Type.Array(Type.String()),
    frames: Type.Array(FrameFactType),
  }),
  Type.Object({
    kind: Type.Literal("chrome"),
    theme: Type.Union([Type.Literal("light"), Type.Literal("dark")]),
    variables: Type.Record(Type.String(), Type.String()),
  }),
  Type.Object({ kind: Type.Literal("theme"), night: Type.Boolean() }),
  Type.Object({
    kind: Type.Literal("lights"),
    you: Type.Union([SubjectType, Type.Null()]),
    agents: Type.Array(SubjectType),
    follow: Type.Union([Type.Literal("you"), Type.Literal("agents"), Type.Null()]),
  }),
  Type.Object({
    kind: Type.Literal("camera"),
    to: Type.Union([Type.Literal("fit"), Type.Literal("actual"), Type.Literal("selection")]),
  }),
  Type.Object({ kind: Type.Literal("reveal"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("applied"), from: SpanType, to: SpanType }),
  Type.Object({ kind: Type.Literal("refused"), from: SpanType }),
]);

/** What the app tells the board. */
export type AppMessage = Static<typeof AppMessageType>;

const BoardMessageType = Type.Union([
  Type.Object({ kind: Type.Literal("ready") }),
  Type.Object({ kind: Type.Literal("zoom"), zoom: Type.Number({ exclusiveMinimum: 0 }) }),
  Type.Object({ kind: Type.Literal("select"), span: Type.Union([SpanType, Type.Null()]) }),
  Type.Object({
    kind: Type.Literal("text"),
    key: SpanType,
    value: Type.String({ maxLength: 4096 }),
  }),
  Type.Object({
    kind: Type.Literal("move"),
    key: SpanType,
    x: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
    y: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
  }),
]);

/** What the board asks of the app. A `text` or `move` is answered with `applied` or `refused`. */
export type BoardMessage = Static<typeof BoardMessageType>;

/** The name the board's document reads the stamped runtime from. */
export const BOARD_GLOBAL = "__nyteBoard";

export function readAppMessage(data: unknown): AppMessage | undefined {
  return Value.Check(AppMessageType, data) ? data : undefined;
}

export function readBoardMessage(data: unknown): BoardMessage | undefined {
  return Value.Check(BoardMessageType, data) ? data : undefined;
}

/** The `data-src` form of a span: `path:start:end`. */
export function spanKey(span: Span): string {
  return `${span.path}:${String(span.start)}:${String(span.end)}`;
}

export function readSpanKey(key: string): Span | undefined {
  const match = /^(?<path>.+):(?<start>\d+):(?<end>\d+)$/u.exec(key);
  const groups = match?.groups;

  if (groups === undefined) return undefined;

  return { path: groups["path"] ?? "", start: Number(groups["start"]), end: Number(groups["end"]) };
}
