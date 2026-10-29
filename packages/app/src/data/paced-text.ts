import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { TextMessage } from "@nyte-ai/plugin/client/presentation";
import type { Message } from "@nyte-ai/sdk";

const TARGET_CHARS_PER_FRAME = 24;

const MAX_LAG_FRAMES = 8;

const BARRIER_MAX_WAIT_MS = 250;

const MIN_FRAME_FLUSH_INTERVAL_MS = 16;

const SEGMENT_LOOKAHEAD = 32;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Pace {
  readonly text: string;
  readonly shown: number;
  readonly flushedAt: number;
  readonly drainFrames: number | undefined;
}

interface Reveal {
  readonly message: TextMessage;
  readonly status: TextMessage["status"];
  readonly pace: Pace;
}

export function settledPace(text: string): Pace {
  return { text, shown: text.length, flushedAt: 0, drainFrames: undefined };
}

export function extendPace(pace: Pace, text: string, now: number): Pace {
  if (!text.startsWith(pace.text.slice(0, pace.shown))) return flushPace({ ...pace, text }, now);

  return { ...pace, text, drainFrames: text.length === pace.shown ? undefined : pace.drainFrames };
}

export function flushPace(pace: Pace, now: number): Pace {
  if (pace.shown === pace.text.length) return { ...pace, drainFrames: undefined };

  return { text: pace.text, shown: pace.text.length, flushedAt: now, drainFrames: undefined };
}

export function drainPace(pace: Pace, now: number): Pace {
  const pending = pace.text.length - pace.shown;

  if (pending === 0) return pace;

  if (pending <= TARGET_CHARS_PER_FRAME) return flushPace(pace, now);

  return { ...pace, drainFrames: pace.drainFrames ?? MAX_LAG_FRAMES };
}

export function framePace(pace: Pace, now: number): Pace {
  if (now - pace.flushedAt < MIN_FRAME_FLUSH_INTERVAL_MS) return pace;

  const pending = pace.text.slice(pace.shown);

  if (pending.length <= TARGET_CHARS_PER_FRAME) return flushPace(pace, now);

  const budget = Math.max(
    TARGET_CHARS_PER_FRAME,
    Math.ceil(pending.length / (pace.drainFrames ?? MAX_LAG_FRAMES)),
  );

  const shown = pace.shown + chunkLength(pending, budget);

  return {
    text: pace.text,
    shown,
    flushedAt: now,
    drainFrames:
      shown === pace.text.length || pace.drainFrames === undefined
        ? undefined
        : Math.max(1, pace.drainFrames - 1),
  };
}

export function chunkLength(pending: string, budget: number): number {
  if (pending.length <= budget) return pending.length;

  const space = pending.slice(0, budget).search(/\s\S*$/u);

  if (space !== -1) return space + 1;

  const ahead = pending.slice(0, budget + SEGMENT_LOOKAHEAD);
  const word = words.segment(ahead).containing(budget)?.index ?? 0;

  if (word > 0) return word;

  const grapheme = graphemes.segment(ahead).containing(budget);

  if (grapheme === undefined) return pending.length;

  return grapheme.index > 0 ? grapheme.index : grapheme.segment.length;
}

export function createTextPacer<V extends { readonly messages: readonly Message[] }>(
  visible: () => boolean,
  revise: (view: V) => void,
) {
  let latest: V | undefined;
  let reveal: Reveal | undefined;
  let frame: number | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const present = (view: V): V => {
    const current = reveal;

    if (current === undefined) return view;
    const markdown = current.pace.text.slice(0, current.pace.shown);

    if (markdown === current.message.state.markdown && current.status === current.message.status)
      return view;

    return {
      ...view,
      messages: view.messages.map((message) =>
        message.id === current.message.id
          ? {
              ...current.message,
              state: { ...current.message.state, markdown },
              status: current.status,
            }
          : message,
      ),
    };
  };

  const settle = (next: Reveal | undefined): void => {
    reveal =
      next === undefined ||
      (next.pace.shown === next.pace.text.length && next.message.status.kind !== "live")
        ? undefined
        : next;

    if (reveal?.pace.drainFrames === undefined) {
      clearTimeout(deadline);
      deadline = undefined;
    } else deadline ??= setTimeout(flush, BARRIER_MAX_WAIT_MS);

    if (reveal !== undefined && reveal.pace.shown < reveal.pace.text.length)
      frame ??= requestAnimationFrame(tick);
    else if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  function tick(): void {
    frame = undefined;
    const current = reveal;

    if (current === undefined || latest === undefined) return;
    const now = Date.now();
    settle({
      ...current,
      pace: visible() ? framePace(current.pace, now) : flushPace(current.pace, now),
    });

    if (reveal?.pace.shown !== current.pace.shown) revise(present(latest));
  }

  function flush(): void {
    const current = reveal;

    if (current === undefined || latest === undefined) return;
    settle({ ...current, pace: flushPace(current.pace, Date.now()) });
    revise(present(latest));
  }

  return {
    receive(view: V): V {
      if (typeof requestAnimationFrame !== "function") return view;
      const now = Date.now();
      const showing = visible();
      const opening = latest === undefined || !showing;
      const current = reveal;
      latest = view;

      const live = view.messages.findLast(
        (message): message is TextMessage => showsText(message) && message.status.kind === "live",
      );

      const same = view.messages.find((message) => message.id === current?.message.id);

      if (
        current !== undefined &&
        same !== undefined &&
        showsText(same) &&
        (live === undefined || live.id === same.id)
      ) {
        const pace = extendPace(current.pace, same.state.markdown, now);

        if (same.status.kind === "live")
          settle({
            message: same,
            status: same.status,
            pace: showing ? pace : flushPace(pace, now),
          });
        else
          settle({
            message: same,
            status: current.status,
            pace: showing ? drainPace(pace, now) : flushPace(pace, now),
          });
      } else
        settle(
          live === undefined
            ? undefined
            : {
                message: live,
                status: live.status,
                pace: opening
                  ? settledPace(live.state.markdown)
                  : extendPace(settledPace(""), live.state.markdown, now),
              },
        );

      return present(view);
    },
    dispose(): void {
      settle(undefined);
    },
  };
}
