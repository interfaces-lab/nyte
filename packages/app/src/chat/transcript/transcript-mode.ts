import type { ScrollViewState } from "../../panes/session-view-state.ts";

export const FOLLOW_TOLERANCE = 4;

const INPUT_WINDOW = 250;

export interface ReaderInput {
  readonly at: number;
  readonly upward: boolean;
  readonly pressed: boolean;
}

export const NO_INPUT: ReaderInput = { at: -Infinity, upward: false, pressed: false };

export function touching(input: ReaderInput, now: number): boolean {
  return input.pressed || now - input.at <= INPUT_WINDOW;
}

export function steeringUp(input: ReaderInput, now: number): boolean {
  return input.pressed || (touching(input, now) && input.upward);
}

export interface Anchor {
  readonly key: string;
  readonly element: Element | undefined;
  readonly top: number;
}

export type TranscriptMode =
  | { readonly kind: "following"; readonly opening: boolean }
  | { readonly kind: "reading"; readonly anchor: Anchor | null };

export type TranscriptEvent =
  | {
      readonly kind: "scrolled";
      readonly distance: number;
      readonly upward: boolean;
      readonly reader: boolean;
    }
  | { readonly kind: "quiet"; readonly distance: number }
  | { readonly kind: "touched" }
  | { readonly kind: "held"; readonly anchor: Anchor }
  | { readonly kind: "ended" }
  | { readonly kind: "opened" };

const FOLLOWING: TranscriptMode = { kind: "following", opening: false };

const READING: TranscriptMode = { kind: "reading", anchor: null };

export function initialMode(position: ScrollViewState): TranscriptMode {
  return position.kind === "end"
    ? { kind: "following", opening: true }
    : {
        kind: "reading",
        anchor: { key: position.key, element: undefined, top: position.offset },
      };
}

export function nextMode(mode: TranscriptMode, event: TranscriptEvent): TranscriptMode {
  switch (event.kind) {
    case "scrolled":
      if (mode.kind === "following")
        return event.upward &&
          (event.reader || (!mode.opening && event.distance > FOLLOW_TOLERANCE))
          ? READING
          : mode;

      return mode.anchor === null && !event.upward && event.distance <= FOLLOW_TOLERANCE
        ? FOLLOWING
        : mode;
    case "quiet":
      return mode.kind === "reading" && mode.anchor === null && event.distance <= FOLLOW_TOLERANCE
        ? FOLLOWING
        : mode;
    case "touched":
      return mode.kind === "reading" ? READING : mode;
    case "held":
      return { kind: "reading", anchor: event.anchor };
    case "ended":
      return FOLLOWING;
    case "opened":
      return mode.kind === "following" ? FOLLOWING : mode;
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

const OWN_WRITE_TOLERANCE = 1.5;

const DRIFT_TOLERANCE = 0.5;

export interface TranscriptScroll {
  readonly mode: TranscriptMode;
  readonly input: ReaderInput;
  readonly last: { readonly offset: number; readonly height: number };
  readonly written: number | null;
}

export function initialScroll(position: ScrollViewState): TranscriptScroll {
  return {
    mode: initialMode(position),
    input: NO_INPUT,
    last: { offset: 0, height: 0 },
    written: null,
  };
}

export function touchScroll(
  state: TranscriptScroll,
  upward: boolean,
  now: number,
): TranscriptScroll {
  return {
    ...state,
    input: { at: now, upward, pressed: state.input.pressed },
    mode: nextMode(state.mode, { kind: "touched" }),
  };
}

export interface SampledScroll {
  readonly state: TranscriptScroll;
  readonly cancel: boolean;
}

export interface ScrollSample {
  readonly offset: number;
  readonly height: number;
  readonly clientHeight: number;
  readonly frameInput: boolean;
  readonly now: number;
}

export function sampleScroll(state: TranscriptScroll, sample: ScrollSample): SampledScroll {
  const own =
    state.written !== null && Math.abs(sample.offset - state.written) < OWN_WRITE_TOLERANCE;

  const grown = sample.height >= state.last.height;
  const upward = sample.offset < state.last.offset && grown;
  const cancel = !own && sample.offset !== state.last.offset && grown && sample.frameInput;
  const touched = cancel ? touchScroll(state, upward, sample.now) : state;

  return {
    cancel,
    state: {
      ...touched,
      last: { offset: sample.offset, height: sample.height },
      written: null,
      mode: nextMode(touched.mode, {
        kind: "scrolled",
        distance: sample.height - sample.clientHeight - sample.offset,
        upward,
        reader: steeringUp(touched.input, sample.now),
      }),
    },
  };
}

export function wroteScroll(
  state: TranscriptScroll,
  target: number,
  max: number,
): TranscriptScroll {
  return { ...state, written: Math.min(Math.max(target, 0), max) };
}

export interface SettleMeasure {
  readonly now: number;
  readonly distance: number;
  readonly ready: boolean;
  readonly anchor: {
    readonly connected: boolean;
    readonly rowTop: number | undefined;
    readonly elementTop: number | undefined;
  } | null;
}

export type SettleAction =
  | { readonly kind: "none" }
  | { readonly kind: "end" }
  | { readonly kind: "offset"; readonly by: number };

export interface SettledScroll {
  readonly state: TranscriptScroll;
  readonly action: SettleAction;
}

const NO_ACTION: SettleAction = { kind: "none" };

export function settleScroll(state: TranscriptScroll, measure: SettleMeasure): SettledScroll {
  const mode = touching(state.input, measure.now)
    ? state.mode
    : nextMode(state.mode, { kind: "quiet", distance: measure.distance });

  if (mode.kind === "following") {
    if (measure.distance <= 1)
      return {
        state: {
          ...state,
          mode: mode.opening && measure.ready ? nextMode(mode, { kind: "opened" }) : mode,
        },
        action: NO_ACTION,
      };

    return {
      state: { ...state, mode },
      action: steeringUp(state.input, measure.now) ? NO_ACTION : { kind: "end" },
    };
  }

  const anchor = mode.anchor;
  const rowTop = measure.anchor?.rowTop;

  if (anchor === null || measure.anchor === null || rowTop === undefined)
    return { state: { ...state, mode }, action: NO_ACTION };

  if (!measure.anchor.connected)
    return {
      state: {
        ...state,
        mode: nextMode(mode, {
          kind: "held",
          anchor: { key: anchor.key, element: undefined, top: rowTop },
        }),
      },
      action: NO_ACTION,
    };

  const drift = (measure.anchor.elementTop ?? rowTop) - anchor.top;

  return {
    state: { ...state, mode },
    action: Math.abs(drift) > DRIFT_TOLERANCE ? { kind: "offset", by: drift } : NO_ACTION,
  };
}

export function adjustsOnResize(
  mode: TranscriptMode,
  item: { readonly start: number; readonly end: number; readonly measured: boolean },
  fold: number,
): boolean {
  if (mode.kind === "reading" && mode.anchor !== null) return false;

  return item.measured ? item.end <= fold : item.start < fold;
}

export interface HistoryTop {
  readonly top: string | undefined;
  readonly older: boolean;
}

export interface HistoryPager {
  readonly loading: boolean;
  readonly stalled: boolean;
  readonly failures: number;
  readonly retryAt: number;
  readonly empty: number;
  readonly from: HistoryTop | null;
  readonly exhausted: string | null;
}

export const IDLE_HISTORY: HistoryPager = {
  loading: false,
  stalled: false,
  failures: 0,
  retryAt: -Infinity,
  empty: 0,
  from: null,
  exhausted: null,
};

const EMPTY_PAGES = 3;

const RETRY_MS = 1_000;

const RETRY_MAX_MS = 30_000;

export type HistoryEvent =
  | ({
      readonly kind: "present";
      readonly nearTop: boolean;
      readonly opening: boolean;
      readonly now: number;
    } & HistoryTop)
  | ({ readonly kind: "asked" } & HistoryTop)
  | { readonly kind: "loaded"; readonly count: number }
  | { readonly kind: "failed"; readonly now: number };

export interface HistoryStep {
  readonly pager: HistoryPager;
  readonly action: "none" | "load" | "next-frame";
}

export function nextHistory(pager: HistoryPager, event: HistoryEvent): HistoryStep {
  switch (event.kind) {
    case "present":
      if (
        pager.loading ||
        !event.nearTop ||
        event.opening ||
        (pager.stalled && pager.failures === 0) ||
        (pager.failures > 0 && event.now < pager.retryAt) ||
        (!event.older && event.top === pager.exhausted)
      )
        return none(pager);

      return { pager: { ...pager, loading: true, from: from(event) }, action: "load" };
    case "asked":
      return pager.loading
        ? none(pager)
        : { pager: { ...pager, loading: true, stalled: false, from: from(event) }, action: "load" };
    case "loaded":
      return loaded(pager, event.count);
    case "failed": {
      const failures = pager.failures + 1;

      return none({
        ...pager,
        loading: false,
        stalled: true,
        failures,
        retryAt: event.now + Math.min(RETRY_MS * 2 ** (failures - 1), RETRY_MAX_MS),
        from: null,
      });
    }

    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

function none(pager: HistoryPager): HistoryStep {
  return { pager, action: "none" };
}

function from(event: HistoryTop): HistoryTop {
  return { top: event.top, older: event.older };
}

function loaded(pager: HistoryPager, count: number): HistoryStep {
  if (count > 0) return { pager: IDLE_HISTORY, action: "next-frame" };

  if (pager.from?.older !== true)
    return none({ ...IDLE_HISTORY, exhausted: pager.from?.top ?? null });
  const empty = pager.empty + 1;
  const stalled = empty >= EMPTY_PAGES;

  return {
    pager: { ...IDLE_HISTORY, stalled, empty },
    action: stalled ? "none" : "next-frame",
  };
}
