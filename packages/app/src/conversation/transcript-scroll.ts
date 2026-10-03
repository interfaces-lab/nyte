/**
 * Scroll arithmetic for the virtualized transcript. Everything here is pure
 * so the thread screen can feed it numbers it already has (virtual item
 * starts, cached sizes, scrollport metrics) instead of measuring the DOM.
 */

/** Mirrors the transcript's former `paddingTop`. */
export const TRANSCRIPT_PADDING_START = 16;

/**
 * Room below the last row, above the docked composer: Cursor's composer
 * clearance (100px) plus its input gap (14px). It is part of the scroll
 * extent, so a reply that ends at the bottom never sits against the composer.
 */
export const TRANSCRIPT_PADDING_END = 114;

/** A row's own top may sit a hair below the scroll offset after subpixel layout. */
const STICKY_MESSAGE_ACTIVATION_EPSILON = 2;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export function isBottomPinned(metrics: ScrollMetrics, threshold: number): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
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
  const padding = TRANSCRIPT_PADDING_START + TRANSCRIPT_PADDING_END;
  const total = sizes.reduce((sum, size) => sum + size, padding);

  return Math.max(0, total - viewportHeight);
}
