import type { Message, PartId, ToolProgress } from "@nyte-ai/schema";
import type { HeadView } from "./head-view.ts";
import type { TextUpdate } from "../live/host-connection.ts";

/**
 * The text and tool progress the host streams for parts ahead of their rows, laid over a head's
 * view. Feed it every update from `connection.text`, and lay it over each view you draw.
 */
export interface StreamedText {
  /** Keeps the update. An `append` to a part whose whole text hasn't arrived is dropped, since the host sends the whole text first. */
  apply(update: TextUpdate): void;
  /**
   * Returns `view` with each live part's streamed text and progress in its state, or `view` itself
   * when nothing streamed changes it. The same view and the same updates return the same object.
   * Text for a part `view` doesn't hold changes nothing. A part `view` shows settled at or past
   * its streamed version is forgotten, so the row takes over and a later `append` to it is dropped.
   */
  lay(view: HeadView): HeadView;
}

interface Streamed {
  readonly text: { readonly version: number; readonly markdown: string } | null;
  readonly progress: ToolProgress | null;
}

interface Laid {
  readonly parts: ReadonlyMap<PartId, Streamed>;
  readonly laid: ReadonlyMap<number, Message>;
  readonly result: HeadView;
}

interface Drawn {
  readonly source: Message;
  readonly result: Message;
}

const drawn = new WeakMap<Streamed, Drawn>();

const indexed = new WeakMap<readonly Message[], ReadonlyMap<PartId, number>>();

export function streamedText(): StreamedText {
  const views = new WeakMap<HeadView, Laid>();
  let parts: ReadonlyMap<PartId, Streamed> = new Map();

  return {
    apply(update) {
      parts = applied(parts, update);
    },
    lay(view) {
      if (parts.size === 0) return view;
      const previous = views.get(view);

      if (previous?.parts === parts) return previous.result;
      const index = indexed.get(view.messages) ?? indexParts(view.messages);
      const laid = new Map<number, Message>();
      const settled = new Set<PartId>();

      for (const [part, streamed] of parts) {
        const at = index.get(part);
        const message = at === undefined ? undefined : view.messages[at];

        if (at === undefined || message === undefined || message.kind !== "part") continue;

        if (
          message.status.kind !== "live" &&
          message.status.kind !== "waiting" &&
          (streamed.text === null || message.version >= streamed.text.version)
        ) {
          settled.add(part);
          continue;
        }

        const next = layPart(message, streamed);

        if (next !== message) laid.set(at, next);
      }

      if (settled.size > 0) parts = new Map([...parts].filter(([part]) => !settled.has(part)));

      const result =
        laid.size === 0
          ? view
          : previous !== undefined &&
              previous.laid.size === laid.size &&
              Array.from(laid).every(([at, message]) => previous.laid.get(at) === message)
            ? previous.result
            : { ...view, messages: replaced(view.messages, laid) };

      views.set(view, { parts, laid, result });

      return result;
    },
  };
}

function applied(
  parts: ReadonlyMap<PartId, Streamed>,
  update: TextUpdate,
): ReadonlyMap<PartId, Streamed> {
  const known = parts.get(update.part);

  switch (update.kind) {
    case "text":
      return new Map(parts).set(update.part, {
        text: { version: update.version, markdown: update.text },
        progress: known?.progress ?? null,
      });
    case "append":
      if (known === undefined || known.text === null) return parts;

      return new Map(parts).set(update.part, {
        text: { version: update.version, markdown: known.text.markdown + update.append },
        progress: known.progress,
      });
    case "progress":
      return new Map(parts).set(update.part, {
        text: known?.text ?? null,
        progress: update.progress,
      });
  }
}

function replaced(
  messages: readonly Message[],
  laid: ReadonlyMap<number, Message>,
): readonly Message[] {
  const copy = messages.slice();

  for (const [at, message] of laid) copy[at] = message;

  return copy;
}

function indexParts(messages: readonly Message[]): ReadonlyMap<PartId, number> {
  const index = new Map(
    messages.flatMap((message, at) =>
      message.kind === "part" ? [[message.part, at] as const] : [],
    ),
  );

  indexed.set(messages, index);

  return index;
}

function layPart(message: Message, streamed: Streamed): Message {
  const known = drawn.get(streamed);

  if (known?.source === message) return known.result;

  if (message.kind !== "part") return message;
  const state = message.state;

  if (typeof state !== "object" || state === null) return message;
  const text = streamed.text;

  const grows =
    text !== null &&
    text.version > message.version &&
    "markdown" in state &&
    typeof state.markdown === "string";

  const progresses = streamed.progress !== null && "phase" in state && state.phase === "running";

  const next: Record<string, unknown> = { ...state };

  if (grows) next["markdown"] = text.markdown;

  if (progresses) next["progress"] = streamed.progress;

  const result =
    grows || progresses
      ? { ...message, version: grows ? text.version : message.version, state: next }
      : message;

  drawn.set(streamed, { source: message, result });

  return result;
}
