/**
 * What you are doing in a review, shared by every surface that shows it: the
 * side chat (open or not, its thread, its draft), which files you opened or
 * closed, and your reviewed marks. The views, the side chat and the diff in
 * the workbench read and write the same state. A reviewed mark keeps
 * the file's blobs from when you marked it, so it goes stale when the file
 * changes again, and it outlives the page in local storage. Marking needs no
 * patch, so the Overview counts your progress without loading one.
 */
import { createContext, use, useState, type ReactElement, type ReactNode } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ComposerDocumentState } from "@nyte-ai/app/conversation/composer-document.ts";
import type { ReviewedState } from "./code";
import type { DemoExchange } from "./demo-thread";

/**
 * The side chat thread on screen. It lives as long as the page does: a side
 * chat is never saved as a chat. A demo thread plays scripted turns; a live
 * one names the forks of the guide its questions cut, created on the first.
 */
export type SideThread =
  | { readonly kind: "demo"; readonly exchanges: readonly DemoExchange[] }
  | { readonly kind: "live"; readonly id: string; readonly startedAt: number };

const draftOf = (text: string): ComposerDocumentState => ({
  text,
  selectionStart: text.length,
  selectionEnd: text.length,
});

interface Local {
  readonly side: boolean;
  readonly thread: SideThread;
  readonly draft: ComposerDocumentState;
  readonly opened: ReadonlyMap<string, boolean>;
  /** Path to the file's blobs, `old..new`, when you marked it reviewed. */
  readonly marks: Readonly<Record<string, string>>;
  /** Bumped to ask the side chat's composer for focus. */
  readonly focus: number;
}

interface Store {
  readonly states: ReadonlyMap<string, Local>;
  readonly update: (reviewId: string, change: (local: Local) => Local) => void;
}

const MarksSchema = Type.Record(Type.String(), Type.String());

const storageKey = (reviewId: string): string => `nyte-lab:reviewed:v2:${reviewId}`;

function readMarks(reviewId: string): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(reviewId)) ?? "{}");

    return Value.Check(MarksSchema, parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const fresh = (reviewId: string): Local => ({
  side: false,
  thread: { kind: "demo", exchanges: [] },
  draft: draftOf(""),
  opened: new Map(),
  marks: readMarks(reviewId),
  focus: 0,
});

const ReviewStore = createContext<Store | undefined>(undefined);

export function ReviewStateProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [states, setStates] = useState<ReadonlyMap<string, Local>>(new Map());

  const update = (reviewId: string, change: (local: Local) => Local): void =>
    setStates((current) => {
      const before = current.get(reviewId) ?? fresh(reviewId);
      const after = change(before);

      if (after.marks !== before.marks)
        window.localStorage.setItem(storageKey(reviewId), JSON.stringify(after.marks));

      return new Map(current).set(reviewId, after);
    });

  return <ReviewStore value={{ states, update }}>{children}</ReviewStore>;
}

/** A changed file as far as marks go: where it is and which change it is. */
interface Marked {
  readonly path: string;
  readonly blobs: string;
}

export function useReviewState(reviewId: string, files: readonly Marked[]) {
  const store = use(ReviewStore);

  if (store === undefined) throw new Error("useReviewState needs a ReviewStateProvider");

  const local = store.states.get(reviewId) ?? fresh(reviewId);
  const update = (change: (local: Local) => Local): void => store.update(reviewId, change);
  const blobsOf = (path: string): string => files.find((file) => file.path === path)?.blobs ?? "";

  const reviewed = (path: string): ReviewedState => {
    const seen = local.marks[path];

    if (seen === undefined) return "unreviewed";

    return seen === blobsOf(path) ? "reviewed" : "changed";
  };

  return {
    side: local.side,
    thread: local.thread,
    setSide: (side: boolean): void => update((current) => ({ ...current, side })),
    /** Drop the thread on screen for an empty one; the next live question forks the guide afresh. */
    startThread: (kind: SideThread["kind"]): void =>
      update((current) => ({
        ...current,
        thread:
          kind === "demo"
            ? { kind, exchanges: [] }
            : {
                kind,
                id: crypto.randomUUID().replaceAll("-", "").slice(0, 8),
                startedAt: Date.now(),
              },
      })),
    /** Change a demo thread's scripted exchanges; a live thread has none. */
    updateDemo: (change: (exchanges: readonly DemoExchange[]) => readonly DemoExchange[]): void =>
      update((current) =>
        current.thread.kind === "demo"
          ? {
              ...current,
              thread: { ...current.thread, exchanges: change(current.thread.exchanges) },
            }
          : current,
      ),
    draft: local.draft,
    focus: local.focus,
    reviewed,
    reviewedCount: files.filter((file) => reviewed(file.path) === "reviewed").length,
    setReviewed: (paths: readonly string[], next: boolean): void =>
      update((current) => {
        const marks = { ...current.marks };

        for (const path of paths) {
          if (next) marks[path] = blobsOf(path);
          else delete marks[path];
        }

        return { ...current, marks };
      }),
    collapsed: (path: string, fallback: boolean): boolean => local.opened.get(path) ?? fallback,
    toggle: (path: string, fallback: boolean): void =>
      update((current) => ({
        ...current,
        opened: new Map(current.opened).set(path, !(current.opened.get(path) ?? fallback)),
      })),
    setAllOpen: (open: boolean): void =>
      update((current) => ({
        ...current,
        opened: new Map(files.map((file) => [file.path, open])),
      })),
    setDraft: (draft: ComposerDocumentState): void => update((current) => ({ ...current, draft })),
    /** Name selected lines in the side chat's draft and open it. */
    addReference: (reference: string): void =>
      update((current) => {
        const text = current.draft.text;

        return {
          ...current,
          side: true,
          draft: draftOf(`${text}${text === "" || text.endsWith(" ") ? "" : " "}${reference} `),
          focus: current.focus + 1,
        };
      }),
    /** Open the side chat with `draft` in its composer, focused. */
    compose: (draft: string): void =>
      update((current) => ({
        ...current,
        side: true,
        draft: draftOf(draft),
        focus: current.focus + 1,
      })),
  };
}
