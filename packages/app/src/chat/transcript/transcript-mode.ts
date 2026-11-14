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

/** Within this distance, a scroll event reports the transcript's own last write, not the reader. */
const OWN_WRITE_TOLERANCE = 1.5;

/** Below this, an anchor's drift is rounding, not movement. */
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

/** The reader's own input: the anchor drops, and the transcript stops its own smooth scroll. */
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
  /** The reader took over, so the transcript's own smooth scroll stops. */
  readonly cancel: boolean;
}

export interface ScrollSample {
  readonly offset: number;
  readonly height: number;
  readonly clientHeight: number;
  readonly frameInput: boolean;
  readonly now: number;
}

/**
 * A scroll event. While an embedded frame has input, a move the transcript didn't write is the
 * reader's, either way; content shrinking under the view never is.
 */
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

/** The offset the transcript just wrote, clamped to where the view can go. */
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
  /**
   * The anchor's tops in the view: its row's, undefined while the row isn't rendered, and its
   * element's, undefined when it has none or it left the DOM, which `connected` tells apart.
   */
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

/**
 * After rows change or the view moves: Following goes back to the end unless the reader is
 * steering up, and Reading moves the view so its anchor stays where it was. An anchor element
 * that left the DOM is replaced by its row.
 */
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

/**
 * Whether a row's size change above the fold moves the view with it. A held anchor compensates
 * through `settleScroll` instead; a measured row counts once it ends above the fold, an unmeasured
 * one once it starts there.
 */
export function adjustsOnResize(
  mode: TranscriptMode,
  item: { readonly start: number; readonly end: number; readonly measured: boolean },
  fold: number,
): boolean {
  if (mode.kind === "reading" && mode.anchor !== null) return false;

  return item.measured ? item.end <= fold : item.start < fold;
}

export interface HistoryPager {
  readonly loading: boolean;
  /** The last page failed, and no page has loaded since. */
  readonly failed: boolean;
}

export const IDLE_HISTORY: HistoryPager = { loading: false, failed: false };

export type HistoryEvent =
  | { readonly kind: "present"; readonly nearTop: boolean; readonly opening: boolean }
  | { readonly kind: "asked" }
  | { readonly kind: "loaded"; readonly count: number }
  | { readonly kind: "failed" };

export interface HistoryStep {
  readonly pager: HistoryPager;
  /** `next-frame` presents again on the next frame, so pages keep coming while the view stays near the top. */
  readonly action: "none" | "load" | "next-frame";
}

/**
 * Rule 27: one page at a time while the view is near the top, once the session has settled.
 * An empty page ends the run of pages, not the pager: the next present asks again, so a page
 * that came back empty because the window moved never strands older messages, and a head with
 * none left answers without asking the host. Asking after a failure loads at once.
 */
export function nextHistory(pager: HistoryPager, event: HistoryEvent): HistoryStep {
  switch (event.kind) {
    case "present":
      return !pager.loading && event.nearTop && !event.opening
        ? { pager: { ...pager, loading: true }, action: "load" }
        : { pager, action: "none" };
    case "asked":
      return pager.loading
        ? { pager, action: "none" }
        : { pager: { loading: true, failed: false }, action: "load" };
    case "loaded":
      return { pager: IDLE_HISTORY, action: event.count > 0 ? "next-frame" : "none" };
    case "failed":
      return { pager: { loading: false, failed: true }, action: "none" };
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}
