import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const Offset = Type.Integer({ minimum: 0 });

export const SpanType = Type.Object({ path: Type.String(), start: Offset, end: Offset });

/** An element of a design file: its workspace-relative path and its offsets in the file's text, in UTF-16 code units. */
export type Span = Static<typeof SpanType>;

export const DESIGN_ATTRIBUTE = {
  frame: "data-frame",
  x: "data-x",
  y: "data-y",
  page: "data-page",
  theme: "data-theme",
  source: "data-src",
  via: "data-via",
} as const;

const DigestType = Type.String({ pattern: "^[0-9a-f]{8}$" });

export type Digest = Static<typeof DigestType>;

export function textDigest(text: string): Digest {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

const ModuleType = Type.Object({ path: Type.String(), code: Type.String(), digest: DigestType });

export type BoardModule = Static<typeof ModuleType>;

const SheetErrorType = Type.Object({
  message: Type.String({ maxLength: 2048 }),
  path: Type.Union([Type.String(), Type.Null()]),
  line: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  column: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

export type SheetError = Static<typeof SheetErrorType>;

const SubjectType = Type.Union([
  Type.Object({ kind: Type.Literal("file"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("span"), ...SpanType.properties }),
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

/** How many page frames the board reports; a board with more treats the rest as plain frames. */
export const MAX_PAGE_FRAMES = 64;

const PageAddressType = Type.String({ maxLength: 8192, pattern: "^https?://[^\\s]+$" });

const Finite = Type.Number();

const Extent = Type.Number({ minimum: 0 });

const PageStateType = Type.Union([
  Type.Literal("still"),
  Type.Literal("live"),
  Type.Literal("entered"),
]);

export type PageState = Static<typeof PageStateType>;

const PageType = Type.Object({
  key: SpanType,
  url: PageAddressType,
  x: Finite,
  y: Finite,
  width: Extent,
  height: Extent,
  scale: Type.Number({ exclusiveMinimum: 0 }),
  state: PageStateType,
});

/**
 * A page frame as drawn: its box in the board's viewport in CSS px, unclipped, and its drawn width over its own CSS
 * width. The page lays out at `width / scale` by `height / scale`.
 */
export type BoardPage = Static<typeof PageType>;

const AppMessageType = Type.Union([
  Type.Object({
    kind: Type.Literal("load"),
    build: Type.Integer({ minimum: 0 }),
    modules: Type.Array(ModuleType),
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
  Type.Object({
    kind: Type.Literal("refused"),
    from: SpanType,
    reason: Type.Union([Type.Literal("changed"), Type.Literal("not-editable")]),
  }),
  Type.Object({ kind: Type.Literal("leave") }),
  Type.Object({ kind: Type.Literal("enter"), key: SpanType }),
  Type.Object({
    kind: Type.Literal("wheel"),
    x: Finite,
    y: Finite,
    deltaX: Finite,
    deltaY: Finite,
    zoom: Type.Boolean(),
  }),
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
    base: DigestType,
    value: Type.String({ maxLength: 4096 }),
  }),
  Type.Object({
    kind: Type.Literal("move"),
    key: SpanType,
    base: DigestType,
    x: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
    y: Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 }),
  }),
  Type.Object({
    kind: Type.Literal("pages"),
    pages: Type.Array(PageType, { maxItems: MAX_PAGE_FRAMES }),
  }),
  Type.Object({
    kind: Type.Literal("drawn"),
    build: Type.Integer({ minimum: 0 }),
    sheets: Type.Array(
      Type.Object({ path: Type.String(), error: Type.Union([SheetErrorType, Type.Null()]) }),
      { maxItems: 4096 },
    ),
  }),
]);

/**
 * What the board asks of the app. A `text` or `move` is answered with `applied` or `refused`. `pages` lists every page
 * frame whenever one's box, scale or state changes, at most once an animation frame.
 */
export type BoardMessage = Static<typeof BoardMessageType>;

/** The name the board's document reads the stamped runtime from. */
export const BOARD_GLOBAL = "__nyteBoard";

export function readAppMessage(data: unknown): AppMessage | undefined {
  return Value.Check(AppMessageType, data) ? data : undefined;
}

export function readBoardMessage(data: unknown): BoardMessage | undefined {
  return Value.Check(BoardMessageType, data) ? data : undefined;
}

export function readPageAddress(value: string | null): string | undefined {
  return Value.Check(PageAddressType, value) ? value : undefined;
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
