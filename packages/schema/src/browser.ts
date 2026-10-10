import type { DocumentRevision, PageId } from "./ids.ts";

/** Returns one open page as a list row. */
export interface PageInfo { readonly id: PageId; readonly url: string; readonly title: string; readonly holders: number }
/** Returns a page's url, title, loading state, revision and history. */
export interface PageView { readonly id: PageId; readonly url: string; readonly title: string; readonly loading: boolean; readonly revision: DocumentRevision; readonly canGoBack: boolean; readonly canGoForward: boolean }
/** Returns a page's accessibility nodes at one revision. */
export interface PageSnapshot { readonly revision: DocumentRevision; readonly nodes: readonly { readonly ref: string; readonly role: string; readonly name: string; readonly editable: boolean; readonly depth: number }[] }
/** Returns one console entry from a page. */
export interface ConsoleEntry { readonly level: "log" | "info" | "warn" | "error"; readonly text: string; readonly at: number }
