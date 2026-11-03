import type { Message, ToolProgress } from "@nyte-ai/schema";
import type { HeadView } from "./head-view.ts";
import type { TextUpdate } from "./host-connection.ts";

export interface StreamedPart {
  readonly version: number;
  readonly text: string | null;
  readonly progress: ToolProgress | null;
}

export type StreamedText = ReadonlyMap<string, StreamedPart>;

type Laid = { readonly texts: StreamedText; readonly result: HeadView };

type Drawn = { readonly source: Message; readonly result: Message };

const views = new WeakMap<HeadView, Laid>();

const drawn = new WeakMap<StreamedPart, Drawn>();

export function streamText(texts: StreamedText, update: TextUpdate): StreamedText {
  const known = texts.get(update.part);

  if ("progress" in update)
    return new Map(texts).set(update.part, {
      version: known?.version ?? 0,
      text: known?.text ?? null,
      progress: update.progress,
    });

  if ("text" in update)
    return new Map(texts).set(update.part, {
      version: update.version,
      text: update.text,
      progress: known?.progress ?? null,
    });

  if (known === undefined || known.text === null) return texts;

  return new Map(texts).set(update.part, {
    version: update.version,
    text: known.text + update.append,
    progress: known.progress,
  });
}

export function withStreamedText(view: HeadView, texts: StreamedText): HeadView {
  if (texts.size === 0) return view;
  const known = views.get(view);

  if (known?.texts === texts) return known.result;
  let changed = false;

  const messages = view.messages.map((message) => {
    const part = message.kind === "part" ? texts.get(message.part) : undefined;
    const laid = part === undefined ? message : layPart(message, part);

    if (laid !== message) changed = true;

    return laid;
  });

  const result =
    changed &&
    known !== undefined &&
    known.result.messages.length === messages.length &&
    known.result.messages.every((message, index) => message === messages[index])
      ? known.result
      : changed
        ? { ...view, messages }
        : view;

  views.set(view, { texts, result });

  return result;
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
