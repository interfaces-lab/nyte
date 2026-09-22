/**
 * Scroll arithmetic for the virtualized transcript. Everything here is pure
 * so the thread screen can feed it numbers it already has (virtual item
 * starts, cached sizes, scrollport metrics) instead of measuring the DOM.
 */

/** Mirrors the transcript's former `paddingTop`. */
export const TRANSCRIPT_PADDING_START = 16;

/** The transcript's former `paddingBottom`, before the standing slack below. */
const TRANSCRIPT_PADDING_END = 8;

/** How close to the end the reader must be for the transcript to follow new content. */
const BOTTOM_PIN_THRESHOLD = 60;

/** A row's own top may sit a hair below the scroll offset after subpixel layout. */
const STICKY_MESSAGE_ACTIVATION_EPSILON = 2;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export function isBottomPinned(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < BOTTOM_PIN_THRESHOLD;
}

export interface StickyCandidate {
  /** Where the turn's top sits in scroll coordinates. */
  readonly start: number;
  /** The whole turn row, prompt and reply. */
  readonly height: number;
}

/**
 * Which candidate's prompt is stuck to the top edge: the last one whose turn
 * has scrolled past the top. While pinned to the bottom the latest turn gets
 * slack equal to its own height, so its prompt lifts as soon as the reply
 * outgrows the viewport instead of waiting for the turn's top to cross the
 * edge.
 */
export function activeStickyCandidate(
  candidates: readonly StickyCandidate[],
  scrollTop: number,
  bottomPinned: boolean,
): number | undefined {
  let active: number | undefined;

  for (const [index, candidate] of candidates.entries()) {
    const last = index === candidates.length - 1;
    const slack = bottomPinned && last ? candidate.height : STICKY_MESSAGE_ACTIVATION_EPSILON;

    if (candidate.start <= scrollTop + slack) active = index;
  }

  return active;
}

/**
 * Room below the last row: its padding plus standing slack, so a reply that
 * ends near the bottom edge still clears the composer and the prompt above it
 * can be read with its answer. Reserving a viewport-sized hole when a message
 * is sent instead would leave dead space whenever the reply came back short,
 * and taking that hole back later would move the content under the reader.
 *
 * The slack is a fifth of the scrollport, bounded, as in Cursor's
 * `--composer-messages-bottom-overscroll`. A scrollport that has not reported
 * its height yet gets the padding alone.
 */
export function transcriptPaddingEnd(viewportHeight: number): number {
  if (viewportHeight <= 0) return TRANSCRIPT_PADDING_END;

  return TRANSCRIPT_PADDING_END + Math.min(240, Math.max(80, Math.round(viewportHeight * 0.2)));
}

/**
 * Where a returning transcript should start before its rows have measured.
 * A reader pinned to the bottom starts at the end of the content, which is
 * as good as the sizes fed in: measured heights land on the right rows,
 * estimates on nearby ones. Anyone else starts where they left off.
 */
export function initialTranscriptOffset({
  sizes,
  viewportHeight,
  scroll,
}: {
  readonly sizes: readonly number[];
  readonly viewportHeight: number;
  readonly scroll: { readonly top: number; readonly bottomPinned: boolean };
}): number {
  if (!scroll.bottomPinned) return scroll.top;
  const padding = TRANSCRIPT_PADDING_START + transcriptPaddingEnd(viewportHeight);
  const total = sizes.reduce((sum, size) => sum + size, padding);

  return Math.max(0, total - viewportHeight);
}
