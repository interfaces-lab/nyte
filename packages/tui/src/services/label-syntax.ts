/**
 * Syntax highlights for single-line labels, where a whole CodeRenderable
 * would cost a block of layout. Tree-sitter answers asynchronously and a
 * grammar may still be downloading, so a caller draws plain text first and
 * redraws when the ranges land.
 */
import { getTreeSitterClient, treeSitterToTextChunks } from "@opentui/core";
import type { SimpleHighlight, SyntaxStyle, TextChunk } from "@opentui/core";

/** A label this long is truncated on screen anyway, so parsing it is waste. */
const MAX_CHARS = 2000;

const CACHE_LIMIT = 256;

/**
 * Ranges, not chunks, are what gets cached: they hold for a piece of text
 * whatever the palette is, so a theme change repaints without reparsing.
 */
export class LabelSyntax {
  private readonly cache = new Map<string, readonly SimpleHighlight[]>();
  private readonly waiting = new Map<string, Set<() => void>>();

  /**
   * The label as styled chunks, or undefined while the highlights are still
   * coming and for text no grammar claims. `onReady` fires once, off the
   * render path, when a first answer arrives.
   */
  chunks(
    text: string,
    filetype: string,
    style: SyntaxStyle,
    onReady: () => void,
  ): TextChunk[] | undefined {
    const ranges = this.ranges(text, filetype, onReady);

    if (ranges === undefined || ranges.length === 0) return undefined;

    return treeSitterToTextChunks(text, [...ranges], style, { enabled: false });
  }

  private ranges(
    text: string,
    filetype: string,
    onReady: () => void,
  ): readonly SimpleHighlight[] | undefined {
    if (text === "" || text.length > MAX_CHARS) return undefined;
    const key = `${filetype}\n${text}`;
    const cached = this.cache.get(key);

    if (cached !== undefined) return cached;
    const pending = this.waiting.get(key);

    if (pending !== undefined) {
      pending.add(onReady);

      return undefined;
    }

    this.waiting.set(key, new Set([onReady]));
    void this.resolve(key, text, filetype);

    return undefined;
  }

  private async resolve(key: string, text: string, filetype: string): Promise<void> {
    let ranges: readonly SimpleHighlight[] = [];

    try {
      // A missing grammar, a failed download, or a worker that never starts
      // all mean the same thing here: leave the label plain.
      ranges = (await getTreeSitterClient().highlightOnce(text, filetype)).highlights ?? [];
    } catch {
      ranges = [];
    }

    this.remember(key, ranges);
    const pending = this.waiting.get(key);
    this.waiting.delete(key);

    if (ranges.length === 0) return;

    for (const notify of pending ?? []) notify();
  }

  private remember(key: string, ranges: readonly SimpleHighlight[]): void {
    this.cache.set(key, ranges);

    if (this.cache.size <= CACHE_LIMIT) return;
    const oldest = this.cache.keys().next();

    if (!oldest.done) this.cache.delete(oldest.value);
  }
}
