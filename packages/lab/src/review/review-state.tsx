/**
 * What you are doing in a review, shared by every surface that shows it: the
 * chat pane's draft and attached code, which files you opened or closed, and
 * your reviewed marks. The Guide in one pane, the chat in the other and the
 * diff in the workbench read and write the same state. Reviewed marks stay
 * attached to the patch you saw and outlive the page in local storage.
 */
import { createContext, use, useState, type ReactElement, type ReactNode } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CodeReference, ReviewedState, ReviewFile } from "./code";

interface Local {
  readonly draft: string;
  readonly references: readonly CodeReference[];
  readonly opened: ReadonlyMap<string, boolean>;
  /** Path to the fingerprint of the patch you marked reviewed. */
  readonly marks: Readonly<Record<string, string>>;
  /** Bumped to ask the chat composer for focus. */
  readonly focus: number;
}

interface Store {
  readonly states: ReadonlyMap<string, Local>;
  readonly update: (reviewId: string, change: (local: Local) => Local) => void;
}

const MarksSchema = Type.Record(Type.String(), Type.String());

const storageKey = (reviewId: string): string => `nyte-lab:reviewed:${reviewId}`;

function readMarks(reviewId: string): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(reviewId)) ?? "{}");

    return Value.Check(MarksSchema, parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const fresh = (reviewId: string): Local => ({
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

/** FNV-1a: enough to tell whether the patch under a reviewed mark changed. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function useReviewState(reviewId: string, files: readonly ReviewFile[]) {
  const store = use(ReviewStore);

  if (store === undefined) throw new Error("useReviewState needs a ReviewStateProvider");

  const local = store.states.get(reviewId) ?? fresh(reviewId);
  const update = (change: (local: Local) => Local): void => store.update(reviewId, change);
  const patchOf = (path: string): string => files.find((file) => file.path === path)?.patch ?? "";

  const reviewed = (path: string): ReviewedState => {
    const seen = local.marks[path];

    if (seen === undefined) return "unreviewed";

    return seen === fingerprint(patchOf(path)) ? "reviewed" : "changed";
  };

  return {
    draft: local.draft,
    references: local.references,
    focus: local.focus,
    reviewed,
    reviewedCount: files.filter((file) => reviewed(file.path) === "reviewed").length,
    setReviewed: (paths: readonly string[], next: boolean): void =>
      update((current) => {
        const marks = { ...current.marks };

        for (const path of paths) {
          if (next) marks[path] = fingerprint(patchOf(path));
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
          : { ...current, references: [...current.references, reference] },
      ),
    /** Put `draft` in the chat composer and ask it for focus. */
    compose: (draft: string): void =>
      update((current) => ({ ...current, draft, focus: current.focus + 1 })),
  };
}
