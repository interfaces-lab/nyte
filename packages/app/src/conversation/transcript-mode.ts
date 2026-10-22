import type { ScrollViewState } from "../layout/session-view-state.ts";

/** A row by key, and optionally a control inside it, kept at `top` px below the scrollport's top. */
export interface Anchor {
  readonly key: string;
  readonly element: Element | undefined;
  readonly top: number;
}

/** `transcript.md`'s two modes. Reading without an anchor leaves size changes to the virtualizer. */
export type TranscriptMode =
  | { readonly kind: "following"; readonly opening: boolean }
  | { readonly kind: "reading"; readonly anchor: Anchor | null };

export type TranscriptEvent =
  | { readonly kind: "scrolled"; readonly atEnd: boolean }
  | { readonly kind: "released"; readonly atEnd: boolean }
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
      if (mode.kind === "reading" ? mode.anchor !== null : mode.opening) return mode;

      return event.atEnd ? FOLLOWING : READING;
    case "released":
      return event.atEnd ? FOLLOWING : READING;
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
