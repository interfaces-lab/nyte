import type { DocumentRevision, PageId } from "./ids.ts";

export type PageInfo = {
  readonly id: PageId;
  readonly url: string;
  readonly title: string;
  readonly holders: number;
};
export type PageView = {
  readonly id: PageId;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly revision: DocumentRevision;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};
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
export type ConsoleEntry = {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
  readonly at: number;
};

export type PageOutcome =
  | { readonly kind: "applied"; readonly snapshot: PageSnapshot }
  | { readonly kind: "stale"; readonly revision: DocumentRevision }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-ref" | "occluded" | "not-visible" | "policy";
    }
  | { readonly kind: "closed"; readonly reason: "released" | "reclaimed" | "crashed" };
