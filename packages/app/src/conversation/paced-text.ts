import { useLayoutEffect, useState, useSyncExternalStore } from "react";

const CHARS_PER_FRAME = 24;

const LAG_FRAMES = 8;

export const FLUSH_INTERVAL_MS = 16;

const DRAIN_MS = 250;

const SEGMENT_LOOKAHEAD = 32;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Pace {
  readonly text: string;
  readonly shown: number;
  readonly framesLeft: number;
  readonly flushedAt: number | undefined;
}

export interface PacedText {
  readonly text: string;
  readonly holding: boolean;
  readonly fresh: boolean;
  readonly resumes: number;
}

interface Reveal {
  readonly text: string;
  readonly fresh: boolean;
  readonly resumes: number;
}

export function settledPace(text: string): Pace {
  return { text, shown: text.length, framesLeft: LAG_FRAMES, flushedAt: undefined };
}

export function stepPace(pace: Pace, text: string, now: number, drainBy: number): Pace {
  if (!text.startsWith(pace.text)) return settledPace(text);

  if (pace.shown === text.length) return pace;

  const due = now >= drainBy;

  if (!due && pace.flushedAt !== undefined && now - pace.flushedAt < FLUSH_INTERVAL_MS) return pace;

  const framesLeft = due ? 1 : text.length > pace.text.length ? LAG_FRAMES : pace.framesLeft;
  const budget = Math.max(CHARS_PER_FRAME, Math.ceil((text.length - pace.shown) / framesLeft));

  return {
    text,
    shown: revealEnd(text, pace.shown, budget),
    framesLeft: Math.max(1, framesLeft - 1),
    flushedAt: now,
  };
}

export function revealEnd(text: string, from: number, budget: number): number {
  if (text.length - from <= budget) return text.length;

  const space = text.slice(from, from + budget).search(/\s\S*$/u);

  if (space !== -1) return from + space + 1;

  const ahead = text.slice(from, from + budget + SEGMENT_LOOKAHEAD);
  const word = words.segment(ahead).containing(budget);

  if (word !== undefined && word.index > 0) return from + word.index;

  const grapheme = graphemes.segment(ahead).containing(budget);

  if (grapheme === undefined) return text.length;

  return from + (grapheme.index > 0 ? grapheme.index : grapheme.segment.length);
}

export function usePacedText(text: string, streaming: boolean, pacing: boolean): PacedText {
  const [pacer] = useState(() => createPacer(text));
  const reveal = useSyncExternalStore(pacer.subscribe, pacer.read);
  const shown = text.startsWith(reveal.text) ? reveal.text : text;

  useLayoutEffect(() => pacer.connect(), [pacer]);
  useLayoutEffect(() => pacer.sync(text, streaming, pacing), [pacer, text, streaming, pacing]);

  return {
    text: shown,
    holding: shown.length < text.length,
    fresh: shown === reveal.text && reveal.fresh,
    resumes: reveal.resumes,
  };
}

function createPacer(initial: string) {
  let target = initial;
  let drainBy = Number.POSITIVE_INFINITY;
  let pace = settledPace(initial);
  let reveal: Reveal = { text: initial, fresh: false, resumes: 0 };
  let frame: number | undefined;
  let stale = false;
  let resumes = 0;
  const listeners = new Set<() => void>();

  const publish = (next: Pace): void => {
    pace = next;

    if (pace.shown < target.length) frame ??= requestAnimationFrame(tick);

    const text = target.slice(0, pace.shown);

    if (text === reveal.text && resumes === reveal.resumes) return;

    reveal = { text, fresh: pace.flushedAt !== undefined, resumes };
    listeners.forEach((listener) => listener());
  };

  function tick(now: number): void {
    frame = undefined;
    publish(stepPace(pace, target, now, drainBy));
  }

  const hide = (): void => {
    if (document.hidden) publish(settledPace(target));
  };

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    read: (): Reveal => reveal,
    connect(): () => void {
      document.addEventListener("visibilitychange", hide);

      return () => {
        document.removeEventListener("visibilitychange", hide);

        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        stale = true;
      };
    },
    sync(text: string, streaming: boolean, pacing: boolean): void {
      target = text;
      drainBy = streaming
        ? Number.POSITIVE_INFINITY
        : Math.min(drainBy, performance.now() + DRAIN_MS);
      const restart = stale || !pacing || document.hidden || !text.startsWith(pace.text);

      if (stale) resumes += 1;
      stale = false;
      publish(restart ? settledPace(text) : pace);
    },
  };
}
