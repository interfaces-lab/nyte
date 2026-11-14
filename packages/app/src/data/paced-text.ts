import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { TextMessage } from "@nyte-ai/plugin/client/presentation";
import type { Message } from "@nyte-ai/sdk";

const TARGET_CHARS_PER_FRAME = 24;

const MAX_LAG_FRAMES = 8;

const BARRIER_MAX_WAIT_MS = 250;

const MIN_FRAME_FLUSH_INTERVAL_MS = 12;

const SEGMENT_LOOKAHEAD = 32;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Pace {
  readonly text: string;
  readonly shown: number;
  readonly flushedAt: number;
  readonly drainFrames: number | undefined;
}

/** A text message and the status it shows until its text has caught up. */
export interface Revealed {
  readonly message: TextMessage;
  readonly status: TextMessage["status"];
}

/**
 * The text message being paced, the status it shows until its text has caught up, and how much of
 * it shows; `next` is a newer live text held empty until this one has shown at its pace.
 */
export interface Reveal extends Revealed {
  readonly pace: Pace;
  readonly next: Revealed | undefined;
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

/**
 * What to pace after a view arrives: the same message while it is still the newest live text, else
 * the newest live text, whole when the chat is opening and from nothing otherwise. A newer live
 * text waits, empty, while the one before it still has text to show, so that text keeps its pace
 * instead of appearing at once. A hidden transcript shows everything at once.
 */
export function receiveReveal(
  current: Reveal | undefined,
  messages: readonly Message[],
  moment: { readonly showing: boolean; readonly opening: boolean; readonly now: number },
): Reveal | undefined {
  const live = messages.findLast(
    (message): message is TextMessage => showsText(message) && message.status.kind === "live",
  );

  const same = messages.find((message) => message.id === current?.message.id);

  if (current === undefined || same === undefined || !showsText(same))
    return settledReveal(
      live === undefined ? undefined : beginReveal({ message: live, status: live.status }, moment),
    );

  const pace = extendPace(current.pace, same.state.markdown, moment.now);
  const waiting = waitingText(current, same, live, messages);

  if (waiting !== undefined) {
    const draining = drainPace(pace, moment.now);

    if (!moment.showing || draining.shown === draining.text.length)
      return settledReveal(beginReveal(waiting, moment));

    return { message: same, status: current.status, pace: draining, next: waiting };
  }

  if (same.status.kind === "live")
    return settledReveal({
      message: same,
      status: same.status,
      pace: moment.showing ? pace : flushPace(pace, moment.now),
      next: undefined,
    });

  return settledReveal({
    message: same,
    status: current.status,
    pace: moment.showing ? drainPace(pace, moment.now) : flushPace(pace, moment.now),
    next: undefined,
  });
}

/** The newer text that waits behind `same`: the newest live text, or the one already waiting. */
function waitingText(
  current: Reveal,
  same: TextMessage,
  live: TextMessage | undefined,
  messages: readonly Message[],
): Revealed | undefined {
  if (live !== undefined && live.id !== same.id) return { message: live, status: live.status };
  const queued = messages.find((message) => message.id === current.next?.message.id);

  return current.next === undefined || queued === undefined || !showsText(queued)
    ? undefined
    : { message: queued, status: current.next.status };
}

/** A text starting to show: whole while the chat opens, else from nothing, draining at once when it has already ended. */
function beginReveal(
  text: Revealed,
  moment: { readonly opening: boolean; readonly now: number },
): Reveal {
  const markdown = text.message.state.markdown;

  if (moment.opening) return { ...text, pace: settledPace(markdown), next: undefined };
  const pace = extendPace(settledPace(""), markdown, moment.now);

  return {
    ...text,
    pace: text.message.status.kind === "live" ? pace : drainPace(pace, moment.now),
    next: undefined,
  };
}

/** One frame of `current`: the next slice while the transcript is showing, else all of it. Once it has all shown, the text waiting behind it starts. */
export function tickReveal(
  current: Reveal,
  moment: { readonly showing: boolean; readonly now: number },
): Reveal | undefined {
  const pace = moment.showing
    ? framePace(current.pace, moment.now)
    : flushPace(current.pace, moment.now);

  if (current.next !== undefined && pace.shown === pace.text.length)
    return settledReveal(beginReveal(current.next, { opening: !moment.showing, now: moment.now }));

  return settledReveal({ ...current, pace });
}

/** A frame while text is still to show, and the barrier deadline while a drain is counting down. */
export function revealTimers(reveal: Reveal | undefined) {
  return {
    frame: reveal !== undefined && reveal.pace.shown < reveal.pace.text.length,
    deadline: reveal?.pace.drainFrames !== undefined,
  };
}

/** `view` with the paced message cut to what has shown, or `view` itself when nothing is held back. */
export function presentReveal<V extends { readonly messages: readonly Message[] }>(
  view: V,
  reveal: Reveal | undefined,
): V {
  if (reveal === undefined) return view;
  const markdown = reveal.pace.text.slice(0, reveal.pace.shown);
  const next = reveal.next;

  if (
    next === undefined &&
    markdown === reveal.message.state.markdown &&
    reveal.status === reveal.message.status
  )
    return view;

  return {
    ...view,
    messages: view.messages.map((message) => {
      if (message.id === reveal.message.id)
        return {
          ...reveal.message,
          state: { ...reveal.message.state, markdown },
          status: reveal.status,
        };

      return message.id === next?.message.id
        ? { ...next.message, state: { ...next.message.state, markdown: "" }, status: next.status }
        : message;
    }),
  };
}

/** A reveal whose text has all shown and whose message has ended has nothing left to pace. */
function settledReveal(next: Reveal | undefined): Reveal | undefined {
  return next === undefined ||
    (next.pace.shown === next.pace.text.length && next.message.status.kind !== "live")
    ? undefined
    : next;
}

export function createTextPacer<V extends { readonly messages: readonly Message[] }>(
  visible: () => boolean,
  revise: (view: V) => void,
) {
  let latest: V | undefined;
  let reveal: Reveal | undefined;
  let frame: number | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const settle = (next: Reveal | undefined): void => {
    reveal = next;
    const timers = revealTimers(next);

    if (timers.deadline) deadline ??= setTimeout(flush, BARRIER_MAX_WAIT_MS);
    else {
      clearTimeout(deadline);
      deadline = undefined;
    }

    if (timers.frame) frame ??= requestAnimationFrame(tick);
    else if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  function tick(now: number): void {
    frame = undefined;
    const current = reveal;

    if (current === undefined || latest === undefined) return;
    settle(tickReveal(current, { showing: visible(), now }));

    if (reveal?.pace.shown !== current.pace.shown || reveal?.message !== current.message)
      revise(presentReveal(latest, reveal));
  }

  function flush(): void {
    const current = reveal;

    if (current === undefined || latest === undefined) return;
    settle(tickReveal(current, { showing: false, now: performance.now() }));
    revise(presentReveal(latest, reveal));
  }

  return {
    receive(view: V): V {
      if (typeof requestAnimationFrame !== "function") return view;
      const now = performance.now();
      const showing = visible();
      const opening = latest === undefined || !showing;
      latest = view;
      settle(receiveReveal(reveal, view.messages, { showing, opening, now }));

      return presentReveal(view, reveal);
    },
    dispose(): void {
      settle(undefined);
    },
  };
}
