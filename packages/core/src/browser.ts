import type { ByteReader, ConsoleEntry, DocumentRevision, Json, PageId, PageInfo, PageOutcome, PageSnapshot, PageView } from "@nyte-ai/schema";

/**
 * Opens, adopts, lists and watches browser pages in a workspace.
 *
 * @category browser
 * @since 0.1.0
 */
export interface BrowserApi {
  /**
   * Opens a new page and returns an owned hold on it.
   *
   * @authority participant
   */
  open(input: { readonly url: string }): Promise<Page>;
  /**
   * Returns a hold on an existing page: same page, not URL matching.
   *
   * @throws {SdkError} unknown when no page has this id.
   * @authority participant
   */
  adopt(id: PageId): Promise<Page>;
  /**
   * Returns every open page.
   *
   * @authority participant
   */
  list(): Promise<readonly PageInfo[]>;
  /**
   * Yields the page list as it changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<readonly PageInfo[]>;
}

/**
 * Returns a hold on one browser page: read it, snapshot it, drive it.
 *
 * **Details**
 *
 * A ref names a node in a snapshot revision; `expect` pins that revision.
 * The viewport that shows the page is a driver adapter; it alone owns
 * bounds, occlusion, focus and screenshot fallback. A page is a workspace
 * resource held by whoever opened it; a tool's hold shows in
 * `view.background`.
 *
 * @category browser
 * @since 0.1.0
 */
export interface Page {
  readonly id: PageId;
  /**
   * Returns url, title, loading and revision.
   *
   * @authority participant
   */
  view(): Promise<PageView>;
  /**
   * Yields the page view as it loads and changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<PageView>;
  /**
   * Returns the accessibility nodes at a revision: ref, role, name,
   * editable. `ref` narrows to a subtree.
   *
   * @authority participant
   */
  snapshot(input?: { readonly ref?: string }): Promise<PageSnapshot>;
  /**
   * Navigates to a url.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  navigate(url: string): Promise<PageOutcome>;
  /**
   * Goes back in history.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  back(): Promise<PageOutcome>;
  /**
   * Goes forward in history.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  forward(): Promise<PageOutcome>;
  /**
   * Reloads the page.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  reload(): Promise<PageOutcome>;
  /**
   * Stops a load in progress.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  stopLoading(): Promise<PageOutcome>;
  /**
   * Clicks a node by ref; volatile, never replayed.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  click(input: { readonly ref: string; readonly button?: "left" | "right" | "middle"; readonly double?: boolean; readonly expect?: DocumentRevision }): Promise<PageOutcome>;
  /**
   * Types into a node by ref.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  type(input: { readonly ref: string; readonly text: string; readonly clear?: boolean; readonly submit?: boolean; readonly expect?: DocumentRevision }): Promise<PageOutcome>;
  /**
   * Presses a key or chord, on a node or the page.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  press(input: { readonly key: string; readonly ref?: string }): Promise<PageOutcome>;
  /**
   * Scrolls the page or a node.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  scroll(input: { readonly direction: "up" | "down" | "top" | "bottom"; readonly ref?: string; readonly pages?: number }): Promise<PageOutcome>;
  /**
   * Waits for load, for text to appear or disappear, or for a delay.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  wait(condition: { readonly kind: "loaded" } | { readonly kind: "text"; readonly text: string; readonly present: boolean } | { readonly kind: "delay"; readonly ms: number }): Promise<PageOutcome>;
  /**
   * Returns console entries, newest first; `clear` empties the buffer.
   *
   * @authority participant
   */
  console(input?: { readonly limit?: number; readonly clear?: boolean }): Promise<readonly ConsoleEntry[]>;
  /**
   * Returns an owned encoded image stream of the page.
   *
   * @stream frames
   * @authority participant
   */
  capture(): Promise<ByteReader>;
  /**
   * Evaluates an expression in the page; with `ref`, the node is `this`.
   *
   * **Gotchas**
   *
   * Gated by the plugin that exposes it, not by a second principal flag.
   *
   * @authority participant
   */
  evaluate(expression: string, options?: { readonly ref?: string }): Promise<{ readonly kind: "value"; readonly value: Json } | { readonly kind: "threw"; readonly message: string }>;
  /**
   * Releases this hold. The page lives while any hold does; policy may
   * reclaim hidden pages.
   *
   * @authority participant
   */
  close(): Promise<void>;
  /** Releases this hold; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}
