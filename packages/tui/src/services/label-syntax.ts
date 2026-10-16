import { getTreeSitterClient, treeSitterToTextChunks } from "@opentui/core";
import type { SimpleHighlight, SyntaxStyle, TextChunk } from "@opentui/core";

const MAX_CHARS = 2000;

const CACHE_LIMIT = 256;

export class LabelSyntax {
  private readonly cache = new Map<string, readonly SimpleHighlight[]>();
  private readonly waiting = new Map<string, Set<() => void>>();

  chunks(
    text: string,
    filetype: string,
    style: SyntaxStyle,
    wait: () => () => void,
  ): TextChunk[] | undefined {
    const ranges = this.ranges(text, filetype, wait);

    if (ranges === undefined || ranges.length === 0) return undefined;

    return treeSitterToTextChunks(text, [...ranges], style, { enabled: false });
  }

  private ranges(
    text: string,
    filetype: string,
    wait: () => () => void,
  ): readonly SimpleHighlight[] | undefined {
    if (text === "" || text.length > MAX_CHARS) return undefined;
    const key = `${filetype}\n${text}`;
    const cached = this.cache.get(key);

    if (cached !== undefined) return cached;
    const pending = this.waiting.get(key);

    if (pending !== undefined) {
      pending.add(wait());

      return undefined;
    }

    this.waiting.set(key, new Set([wait()]));
    void this.resolve(key, text, filetype);

    return undefined;
  }

  private async resolve(key: string, text: string, filetype: string): Promise<void> {
    let ranges: readonly SimpleHighlight[] = [];

    try {
      ranges = (await getTreeSitterClient().highlightOnce(text, filetype)).highlights ?? [];
    } catch {
      ranges = [];
    }

    this.remember(key, ranges);
    const pending = this.waiting.get(key);
    this.waiting.delete(key);

    for (const notify of pending ?? []) notify();
  }

  private remember(key: string, ranges: readonly SimpleHighlight[]): void {
    this.cache.set(key, ranges);

    if (this.cache.size <= CACHE_LIMIT) return;
    const oldest = this.cache.keys().next();

    if (!oldest.done) this.cache.delete(oldest.value);
  }
}
