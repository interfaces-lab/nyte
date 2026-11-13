import type { Message, ToolProgress } from "@nyte-ai/schema";
import type { HeadView } from "./head-view.ts";
import type { TextUpdate } from "../live/host-connection.ts";

export interface StreamedPart {
  readonly version: number;
  readonly text: string | null;
  readonly progress: ToolProgress | null;
}

export type StreamedText = ReadonlyMap<string, StreamedPart>;

type Laid = {
  readonly texts: StreamedText;
  readonly laid: ReadonlyMap<number, Message>;
  readonly result: HeadView;
};

type Drawn = { readonly source: Message; readonly result: Message };

const views = new WeakMap<HeadView, Laid>();

const drawn = new WeakMap<StreamedPart, Drawn>();

const indexed = new WeakMap<readonly Message[], ReadonlyMap<string, number>>();

/** The successor of a map without the parts a view it was laid on holds settled; `streamText` continues from it. */
const pruned = new WeakMap<StreamedText, StreamedText>();

export function streamText(texts: StreamedText, update: TextUpdate): StreamedText {
  const base = pruned.get(texts) ?? texts;
  const known = base.get(update.part);

  if ("progress" in update)
    return new Map(base).set(update.part, {
      version: known?.version ?? 0,
      text: known?.text ?? null,
      progress: update.progress,
    });

  if ("text" in update)
    return new Map(base).set(update.part, {
      version: update.version,
      text: update.text,
      progress: known?.progress ?? null,
    });

  if (known === undefined || known.text === null) return texts;

  return new Map(base).set(update.part, {
    version: update.version,
    text: known.text + update.append,
    progress: known.progress,
  });
}

/** Lays streamed text over the view's parts, returning the view itself when no part in `texts` changes it. A part the view holds settled at or above its streamed version is dropped from the map `streamText` continues from; a live part keeps its entry, since the host's next append builds on it. */
export function withStreamedText(view: HeadView, texts: StreamedText): HeadView {
  if (texts.size === 0) return view;
  const known = views.get(view);

  if (known?.texts === texts) return known.result;
  const index = indexed.get(view.messages) ?? indexParts(view.messages);
  const laid = new Map<number, Message>();
  const settled = new Set<string>();

  for (const entry of texts) {
    const at = index.get(entry[0]);
    const message = at === undefined ? undefined : view.messages[at];

    if (at === undefined || message === undefined || message.kind !== "part") continue;

    if (
      message.status.kind !== "live" &&
      message.status.kind !== "waiting" &&
      message.version >= entry[1].version
    ) {
      settled.add(entry[0]);
      continue;
    }

    const next = layPart(message, entry[1]);

    if (next !== message) laid.set(at, next);
  }

  if (settled.size > 0)
    pruned.set(texts, new Map(Array.from(texts).filter((entry) => !settled.has(entry[0]))));

  const result =
    laid.size === 0
      ? view
      : known !== undefined &&
          known.laid.size === laid.size &&
          Array.from(laid).every((entry) => known.laid.get(entry[0]) === entry[1])
        ? known.result
        : { ...view, messages: replaced(view.messages, laid) };

  views.set(view, { texts, laid, result });

  return result;
}

/** Copies `messages` with each laid message in its place. V8 copies a long array of messages through `Array.prototype.with` about sixty times slower than through `slice`, and this runs once per streamed delta. */
function replaced(
  messages: readonly Message[],
  laid: ReadonlyMap<number, Message>,
): readonly Message[] {
  const copy = messages.slice();

  for (const entry of laid) copy[entry[0]] = entry[1];

  return copy;
}

function indexParts(messages: readonly Message[]): ReadonlyMap<string, number> {
  const index = new Map(
    messages.flatMap((message, at) =>
      message.kind === "part" ? [[message.part, at] as const] : [],
    ),
  );

  indexed.set(messages, index);

  return index;
}

function layPart(message: Message, part: StreamedPart): Message {
  const known = drawn.get(part);

  if (known?.source === message) return known.result;

  if (message.kind !== "part") return message;
  const state = message.state;

  if (typeof state !== "object" || state === null) return message;

  const grows =
    part.text !== null &&
    part.version > message.version &&
    "markdown" in state &&
    typeof state.markdown === "string";

  const progresses = part.progress !== null && "phase" in state && state.phase === "running";
  const next: Record<string, unknown> = { ...state };

  if (grows) next["markdown"] = part.text;

  if (progresses) next["progress"] = part.progress;

  const result =
    grows || progresses
      ? { ...message, version: grows ? part.version : message.version, state: next }
      : message;

  drawn.set(part, { source: message, result });

  return result;
}
