import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { SdkError } from "@nyte-ai/schema";
import type { Message, SessionView, ViewAppend, ViewFrame, ViewSplice } from "@nyte-ai/schema";
import { mapped } from "./streams.ts";

type ViewDelta = Extract<ViewFrame, { readonly kind: "delta" }>;

const TAKE = -1;

const streamed = Compile(Type.Object({ markdown: Type.String() }));

/** Returns each view as the frame `head.watch` sends: the first whole, each later one as what changed since the view before it, compared by identity, so a view that reuses its predecessor's items sends only the items it replaced; a streaming part's message sends only its appended text. */
export function viewFrames(views: AsyncIterable<SessionView>): AsyncIterable<ViewFrame> {
  let previous: SessionView | null = null;

  return mapped(views, (view): ViewFrame => {
    const frame: ViewFrame = previous === null ? { kind: "view", view } : viewDelta(previous, view);
    previous = view;

    return frame;
  });
}

/** Returns the view a frame describes: a whole view as it is, a delta applied to `view`, the frame before it, keeping every item the delta copies; a delta with no view before it, or one that does not fit it, throws `SdkError("invalid")`. */
export function applyViewFrame(view: SessionView | null, frame: ViewFrame): SessionView {
  if (frame.kind === "view") return frame.view;

  if (view === null) throw unfit("A view delta arrived before its view.");
  const messages = applySplice(view.messages, frame.messages);

  return {
    revision: frame.revision === undefined ? view.revision : frame.revision,
    seq: frame.seq,
    activation: frame.activation ?? view.activation,
    messages: frame.appends === undefined ? messages : applyAppends(messages, frame.appends),
    parts: applySplice(view.parts, frame.parts),
    turns: applySplice(view.turns, frame.turns),
    usage: frame.usage ?? view.usage,
    execution: frame.execution ?? view.execution,
    background: applySplice(view.background, frame.background),
    configuration: frame.configuration ?? view.configuration,
    context: frame.context ?? view.context,
    heads: applySplice(view.heads, frame.heads),
    changes: applySplice(view.changes, frame.changes),
    catalog: frame.catalog ?? view.catalog,
  };
}

function viewDelta(previous: SessionView, next: SessionView): ViewDelta {
  const appends: ViewAppend[] = [];

  const messages = splice(previous.messages, next.messages, (before, after, at) => {
    const grown = appendedText(before, after);

    if (grown !== null) appends.push({ at, ...grown });

    return grown !== null;
  });

  return {
    kind: "delta",
    seq: next.seq,
    revision: previous.revision === next.revision ? undefined : next.revision,
    activation: previous.activation === next.activation ? undefined : next.activation,
    messages,
    appends: appends.length === 0 ? undefined : appends,
    parts: splice(previous.parts, next.parts),
    turns: splice(previous.turns, next.turns),
    usage: previous.usage === next.usage ? undefined : next.usage,
    execution: previous.execution === next.execution ? undefined : next.execution,
    background: splice(previous.background, next.background),
    configuration: previous.configuration === next.configuration ? undefined : next.configuration,
    context: previous.context === next.context ? undefined : next.context,
    heads: splice(previous.heads, next.heads),
    changes: splice(previous.changes, next.changes),
    catalog: previous.catalog === next.catalog ? undefined : next.catalog,
  };
}

/**
 * Splices `previous` into `next` by identity: runs of items `next` reuses from
 * `previous`, and the items it does not. `grows` may claim an item that replaced
 * the one at the same place, so it is copied and its change sent apart.
 */
function splice<T>(
  previous: readonly T[],
  next: readonly T[],
  grows?: (before: T, after: T, at: number) => boolean,
): ViewSplice<T> | undefined {
  if (previous === next) return undefined;
  const runs: number[] = [];
  const items: T[] = [];
  let positions: Map<T, number> | null = null;
  let near = 0;

  next.forEach((item, at) => {
    const found = previous[near] === item ? near : (positions ??= indexed(previous)).get(item);

    if (found !== undefined) {
      extend(runs, found);
      near = found + 1;

      return;
    }

    const before = previous[near];

    if (near < previous.length && before !== undefined && grows?.(before, item, at) === true) {
      extend(runs, near);
      near += 1;

      return;
    }

    extend(runs, TAKE);
    items.push(item);
  });

  return runs.length === 2 && runs[0] === 0 && runs[1] === previous.length && items.length === 0
    ? undefined
    : { runs, items };
}

function extend(runs: number[], from: number): void {
  const at = runs.length - 2;
  const last = runs[at];
  const count = runs[at + 1];

  if (
    last !== undefined &&
    count !== undefined &&
    (from === TAKE ? last === TAKE : last !== TAKE && last + count === from)
  ) {
    runs[at + 1] = count + 1;

    return;
  }

  runs.push(from, 1);
}

function indexed<T>(items: readonly T[]): Map<T, number> {
  const positions = new Map<T, number>();

  items.forEach((item, at) => positions.set(item, at));

  return positions;
}

function applySplice<T>(previous: readonly T[], change: ViewSplice<T> | undefined): readonly T[] {
  if (change === undefined) return previous;
  const next: T[] = [];
  let taken = 0;

  for (let at = 0; at < change.runs.length; at += 2) {
    const from = change.runs[at] ?? 0;
    const count = change.runs[at + 1] ?? 0;
    const source = from === TAKE ? change.items : previous;
    const start = from === TAKE ? taken : from;

    if (count < 0 || start < 0 || start + count > source.length)
      throw unfit("A view delta does not fit the view before it.");
    next.push(...source.slice(start, start + count));

    if (from === TAKE) taken += count;
  }

  return next;
}

function applyAppends(messages: readonly Message[], appends: readonly ViewAppend[]): Message[] {
  const next = [...messages];

  for (const { at, append, version } of appends) {
    const message = next[at];
    const state = message?.kind === "part" ? message.state : null;

    if (message?.kind !== "part" || !streamed.Check(state))
      throw unfit("A view delta appends to a message that streams no text.");
    next[at] = { ...message, version, state: { ...state, markdown: state.markdown + append } };
  }

  return next;
}

/** Returns the text `after` appended to `before`'s markdown when that, and its version, is all that changed: every other field of the message and of its state is the same value. */
function appendedText(
  before: Message,
  after: Message,
): { readonly append: string; readonly version: number } | null {
  if (
    before.kind !== "part" ||
    after.kind !== "part" ||
    !streamed.Check(before.state) ||
    !streamed.Check(after.state) ||
    after.state.markdown.length <= before.state.markdown.length ||
    !after.state.markdown.startsWith(before.state.markdown) ||
    !sameBesides(before, after, ["version", "state"]) ||
    !sameBesides(before.state, after.state, ["markdown"])
  )
    return null;

  return {
    append: after.state.markdown.slice(before.state.markdown.length),
    version: after.version,
  };
}

function sameBesides<T extends Readonly<Record<string, unknown>>>(
  before: T,
  after: T,
  besides: readonly (keyof T)[],
): boolean {
  const kept = new Map(Object.entries(before));
  const entries = Object.entries(after);

  return (
    entries.length === kept.size &&
    entries.every(
      ([key, value]) => besides.includes(key) || (kept.has(key) && kept.get(key) === value),
    )
  );
}

function unfit(message: string): SdkError {
  return new SdkError("invalid", message);
}
