/**
 * What you are doing in a review, shared by every surface that shows it: the
 * side chat (open or not, its thread, its draft and attached code), which
 * files you opened or closed, and your reviewed marks. The Guide in one pane, the chat in the other and the
 * diff in the workbench read and write the same state. A reviewed mark keeps
 * the file's blobs from when you marked it, so it goes stale when the file
 * changes again, and it outlives the page in local storage. Marking needs no
 * patch, so the Overview counts your progress without loading one.
 */
import { createContext, use, useState, type ReactElement, type ReactNode } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CodeReference, ReviewedState } from "./code";

/** The side chat thread on screen. It lives as long as the page does: a side chat is never saved as a chat. */
export interface SideThread {
  readonly id: string;
  readonly startedAt: number;
}

interface Local {
  readonly side: boolean;
  readonly thread: SideThread | undefined;
  readonly draft: string;
  readonly references: readonly CodeReference[];
  readonly opened: ReadonlyMap<string, boolean>;
  /** Path to the file's blobs, `old..new`, when you marked it reviewed. */
  readonly marks: Readonly<Record<string, string>>;
  /** Bumped to ask the chat composer for focus. */
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
  thread: undefined,
  draft: "",
  references: [],
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
    /** The thread a question goes to: the one on screen, or a new one it starts. */
    threadForQuestion: (): SideThread => {
      if (local.thread !== undefined) return local.thread;

      const thread = {
        id: crypto.randomUUID().replaceAll("-", "").slice(0, 8),
        startedAt: Date.now(),
      };

      update((current) => ({ ...current, thread }));

      return thread;
    },
    /** Put the side chat back to empty; the next question forks the guide afresh. */
    newThread: (): void =>
      update((current) => ({ ...current, thread: undefined, draft: "", references: [] })),
    draft: local.draft,
    references: local.references,
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
    setDraft: (draft: string): void => update((current) => ({ ...current, draft })),
    setReferences: (references: readonly CodeReference[]): void =>
      update((current) => ({ ...current, references })),
    addReference: (reference: CodeReference): void =>
      update((current) =>
        current.references.some(
          (entry) =>
            entry.path === reference.path &&
            entry.side === reference.side &&
            entry.start === reference.start &&
            entry.end === reference.end,
        )
          ? current
          : { ...current, side: true, references: [...current.references, reference] },
      ),
    /** Open the side chat with `draft` in its composer, focused. */
    compose: (draft: string): void =>
      update((current) => ({ ...current, side: true, draft, focus: current.focus + 1 })),
  };
}
