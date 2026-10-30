import type { ScrollViewState } from "../../panes/session-view-state.ts";

/** How close to the end still counts as at the end: fractional offsets at non-integer zoom can leave 1–3 px. */
export const FOLLOW_TOLERANCE = 4;

/** How long the reader's input explains the scrolling that follows it. */
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

/**
 * In `scrolled`, `upward` means the view moved up on its own rather than because the content
 * shrank under it, and `reader` means the reader's input explains it.
 */
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
