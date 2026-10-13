import type { DocumentRevision, PageId } from "./ids.ts";

/** Returns one open page as a list row. */
export type PageInfo = {
  readonly id: PageId;
  readonly url: string;
  readonly title: string;
  readonly holders: number;
};
/** Returns a page's url, title, loading state, revision and history. */
export type PageView = {
  readonly id: PageId;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly revision: DocumentRevision;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};
/** Returns a page's accessibility nodes at one revision. */
export type PageSnapshot = {
  readonly revision: DocumentRevision;
  readonly nodes: readonly {
    readonly ref: string;
    readonly role: string;
    readonly name: string;
    readonly editable: boolean;
    readonly depth: number;
  }[];
};
/** Returns one console entry from a page. */
export type ConsoleEntry = {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
  readonly at: number;
};

/**
 * Returns the result of a page action.
 *
 * **Outcomes**
 *
 * - `applied`: done; `snapshot` is the page after.
 * - `stale`: `expect` lost; `revision` is current; snapshot again.
 * - `refused`: the ref is unknown, occluded or not visible, or policy said no.
 * - `closed`: the page is gone: released, reclaimed or crashed.
 *
 * @category browser
 * @since 0.1.0
 */
export type PageOutcome =
  | { readonly kind: "applied"; readonly snapshot: PageSnapshot }
  | { readonly kind: "stale"; readonly revision: DocumentRevision }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-ref" | "occluded" | "not-visible" | "policy";
    }
  | { readonly kind: "closed"; readonly reason: "released" | "reclaimed" | "crashed" };
