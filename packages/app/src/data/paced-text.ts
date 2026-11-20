import { showsText } from "@nyte-ai/plugin/client/presentation";
import type { TextMessage } from "@nyte-ai/plugin/client/presentation";
import type { Message } from "@nyte-ai/sdk";

const TARGET_CHARS_PER_FRAME = 24;

const MAX_LAG_FRAMES = 8;

const WAITING_DRAIN_FRAMES = 3;

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

export interface Revealed {
  readonly message: TextMessage;
  readonly status: TextMessage["status"];
}

export interface Reveal extends Revealed {
  readonly pace: Pace;
  readonly waiting: readonly Revealed[];
}

const NOTHING_WAITING: readonly Revealed[] = [];

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

export function drainPace(pace: Pace, now: number, frames = MAX_LAG_FRAMES): Pace {
  const pending = pace.text.length - pace.shown;

  if (pending === 0) return pace;

  if (pending <= TARGET_CHARS_PER_FRAME) return flushPace(pace, now);

  return { ...pace, drainFrames: Math.min(pace.drainFrames ?? frames, frames) };
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
  const waiting = waitingTexts(current, same, live, messages);

  if (waiting.length > 0) {
    const draining = drainPace(pace, moment.now, WAITING_DRAIN_FRAMES);

    if (!moment.showing || draining.shown === draining.text.length)
      return settledReveal(revealWaiting(waiting, moment));

    return { message: same, status: current.status, pace: draining, waiting };
  }

  if (same.status.kind === "live")
    return settledReveal({
      message: same,
      status: same.status,
      pace: moment.showing ? pace : flushPace(pace, moment.now),
      waiting: NOTHING_WAITING,
    });

  return settledReveal({
    message: same,
    status: current.status,
    pace: moment.showing ? drainPace(pace, moment.now) : flushPace(pace, moment.now),
    waiting: NOTHING_WAITING,
  });
}

function waitingTexts(
  current: Reveal,
  same: TextMessage,
  live: TextMessage | undefined,
  messages: readonly Message[],
): readonly Revealed[] {
  const queued = current.waiting.flatMap((text) => {
    const message = messages.find((candidate) => candidate.id === text.message.id);

    return message === undefined || !showsText(message) ? [] : [{ message, status: text.status }];
  });

  if (
    live === undefined ||
    live.id === same.id ||
    queued.some((text) => text.message.id === live.id)
  )
    return queued.length === 0 ? NOTHING_WAITING : queued;

  return [...queued, { message: live, status: live.status }];
}

function revealWaiting(
  waiting: readonly Revealed[],
  moment: { readonly opening: boolean; readonly now: number },
): Reveal | undefined {
  const next = moment.opening ? waiting.at(-1) : waiting[0];

  if (next === undefined) return undefined;
  const begun = beginReveal(next, moment);
  const behind = moment.opening ? NOTHING_WAITING : waiting.slice(1);

  if (behind.length === 0) return begun;

  return {
    ...begun,
    pace: drainPace(begun.pace, moment.now, WAITING_DRAIN_FRAMES),
    waiting: behind,
  };
}

function beginReveal(
  text: Revealed,
  moment: { readonly opening: boolean; readonly now: number },
): Reveal {
  const markdown = text.message.state.markdown;

  if (moment.opening) return { ...text, pace: settledPace(markdown), waiting: NOTHING_WAITING };
  const pace = extendPace(settledPace(""), markdown, moment.now);

  return {
    ...text,
    pace: text.message.status.kind === "live" ? pace : drainPace(pace, moment.now),
    waiting: NOTHING_WAITING,
  };
}

export function tickReveal(
  current: Reveal,
  moment: { readonly showing: boolean; readonly now: number },
): Reveal | undefined {
  return moment.showing
    ? revealAfter(current, framePace(current.pace, moment.now), moment)
    : flushReveal(current, moment);
}

export function flushReveal(
  current: Reveal,
  moment: { readonly showing: boolean; readonly now: number },
): Reveal | undefined {
  return revealAfter(current, flushPace(current.pace, moment.now), moment);
}

function revealAfter(
  current: Reveal,
  pace: Pace,
  moment: { readonly showing: boolean; readonly now: number },
): Reveal | undefined {
  if (current.waiting.length > 0 && pace.shown === pace.text.length)
    return settledReveal(
      revealWaiting(current.waiting, { opening: !moment.showing, now: moment.now }),
    );

  return settledReveal({ ...current, pace });
}

export function revealTimers(reveal: Reveal | undefined) {
  return {
    frame: reveal !== undefined && reveal.pace.shown < reveal.pace.text.length,
    deadline: reveal?.pace.drainFrames !== undefined,
  };
}

export function presentReveal<V extends { readonly messages: readonly Message[] }>(
  view: V,
  reveal: Reveal | undefined,
): V {
  if (reveal === undefined) return view;
  const markdown = reveal.pace.text.slice(0, reveal.pace.shown);
  const waiting = new Map(reveal.waiting.map((text) => [text.message.id, text]));

  if (
    waiting.size === 0 &&
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

      const next = waiting.get(message.id);

      return next === undefined
        ? message
        : { ...next.message, state: { ...next.message.state, markdown: "" }, status: next.status };
    }),
  };
}

function settledReveal(next: Reveal | undefined): Reveal | undefined {
  return next === undefined ||
    (next.pace.shown === next.pace.text.length &&
      next.message.status.kind !== "live" &&
      next.waiting.length === 0)
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
    deadline = undefined;

    if (current === undefined || latest === undefined) return;
    settle(flushReveal(current, { showing: visible(), now: performance.now() }));
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
