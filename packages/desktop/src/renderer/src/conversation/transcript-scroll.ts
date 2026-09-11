/**
 * Scroll arithmetic for the virtualized transcript. Everything here is pure
 * so the thread screen can feed it numbers it already has (virtual item
 * starts, cached sizes, scrollport metrics) instead of measuring the DOM.
 */

/** Mirrors the transcript's former `paddingTop`. */
export const TRANSCRIPT_PADDING_START = 16;
/** Mirrors the transcript's former `paddingBottom`. */
export const TRANSCRIPT_PADDING_END = 8;
/** A freshly sent prompt lands where the first turn rests: under the top padding. */
export const PROMPT_TOP_INSET = TRANSCRIPT_PADDING_START;
/** How close to the end the reader must be for the transcript to follow new content. */
export const BOTTOM_PIN_THRESHOLD = 60;
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
 * Bottom overscroll that lets a just-sent prompt scroll up to the top edge
 * before its reply exists. The reserve stands in for the reply: the prompt,
 * the base bottom padding, the composer dock, and the reserve together fill
 * the viewport with the prompt sitting `PROMPT_TOP_INSET` below the edge.
 */
export function overscrollReserve({
  viewportHeight,
  rowHeight,
  dockHeight,
}: {
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly dockHeight: number;
}): number {
  return Math.max(
    0,
    viewportHeight - rowHeight - dockHeight - PROMPT_TOP_INSET - TRANSCRIPT_PADDING_END,
  );
}

/**
 * The reserve gives way to the reply one pixel per pixel so the scroll height
 * holds still until the reply fills the viewport. Content shrinking (a live
 * row swapped for its committed turn) restores the reserve rather than
 * growing past the reservation.
 */
export function remainingOverscroll({
  initial,
  baseline,
  content,
}: {
  readonly initial: number;
  /** Content height when the reserve was taken. */
  readonly baseline: number;
  /** Content height now, padding excluded. */
  readonly content: number;
}): number {
  return Math.min(initial, Math.max(0, initial - (content - baseline)));
}

/**
 * A row that resizes above the viewport would otherwise drag the visible
 * content by its delta. A first measurement corrects the estimate for any row
 * whose top is above the fold; a re-measurement only for a row entirely above
 * it, since a row spanning the fold (a streaming reply) grows below the
 * reader. Backward scrolling skips corrections to avoid a jump cascade.
 */
export function shouldAdjustScrollForResize({
  start,
  end,
  firstMeasure,
  scrollTop,
  scrollingBackward,
}: {
  readonly start: number;
  readonly end: number;
  readonly firstMeasure: boolean;
  readonly scrollTop: number;
  readonly scrollingBackward: boolean;
}): boolean {
  if (firstMeasure) return start < scrollTop;
  return end <= scrollTop && !scrollingBackward;
}

/**
 * Where a returning transcript should start before its rows have measured.
 * A reader pinned to the bottom starts at the end of the content, which is
 * as good as the sizes fed in: measured heights land on the right rows,
 * estimates on nearby ones. Anyone else starts where they left off.
 */
export function initialTranscriptOffset({
  sizes,
  paddingStart,
  paddingEnd,
  viewportHeight,
  scroll,
}: {
  readonly sizes: readonly number[];
  readonly paddingStart: number;
  readonly paddingEnd: number;
  readonly viewportHeight: number;
  readonly scroll: { readonly top: number; readonly bottomPinned: boolean };
}): number {
  if (!scroll.bottomPinned) return scroll.top;
  const total = sizes.reduce((sum, size) => sum + size, paddingStart + paddingEnd);
  return Math.max(0, total - viewportHeight);
}
