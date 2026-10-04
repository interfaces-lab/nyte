/**
 * What the Review page derives from a review: files ready for Pierre, guide
 * sections expanded to the files they cover, and the reviewed marks you left,
 * which stay attached to the patch you saw so a changed file asks again.
 */
import { useState } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { parsePatch, type ReviewedState, type ReviewFile } from "./code";
import type { GuideSection, Patch } from "./wire";

const TEST = /(^|\/)(test|tests|__tests__|e2e)\/|\.(test|spec|browser-test)\.[cm]?[jt]sx?$/;

export function reviewFiles(
  patches: readonly Patch[],
  base: string,
  head: string,
): readonly ReviewFile[] {
  return patches.map((change) => ({
    path: change.path,
    category: TEST.test(change.path) ? "test" : "implementation",
    from: base,
    to: head,
    patch: change.patch,
    added: change.added,
    removed: change.removed,
    metadata:
      change.patch === "" ? undefined : parsePatch(change.patch, `${base}:${head}:${change.path}`),
  }));
}

const covers = (entry: string, path: string): boolean =>
  entry.endsWith("/") ? path.startsWith(entry) : entry === path;

/** A section's files, in the order its paths name them; a directory entry expands in path order. */
export function sectionFiles<File extends { readonly path: string }>(
  section: GuideSection,
  files: readonly File[],
): readonly File[] {
  return section.paths.flatMap((entry) =>
    files
      .filter((file) => covers(entry, file.path))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
  );
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

const MarksSchema = Type.Record(Type.String(), Type.String());

function readMarks(key: string): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");

    return Value.Check(MarksSchema, parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Reviewed marks for one review, kept in this browser. Mount the view with
 * `key={reviewId}` so another review starts from its own marks.
 */
export function useReviewed(reviewId: string, files: readonly ReviewFile[]) {
  const key = `nyte-lab:reviewed:${reviewId}`;
  const [marks, setMarks] = useState(() => readMarks(key));

  const patchOf = (path: string): string | undefined =>
    files.find((file) => file.path === path)?.patch;

  const reviewed = (path: string): ReviewedState => {
    const seen = marks[path];

    if (seen === undefined) return "unreviewed";

    return seen === fingerprint(patchOf(path) ?? "") ? "reviewed" : "changed";
  };

  const setReviewed = (paths: readonly string[], next: boolean): void => {
    const value = { ...marks };

    for (const path of paths) {
      if (next) value[path] = fingerprint(patchOf(path) ?? "");
      else delete value[path];
    }

    window.localStorage.setItem(key, JSON.stringify(value));
    setMarks(value);
  };

  const count = files.filter((file) => reviewed(file.path) === "reviewed").length;

  return { reviewed, setReviewed, count };
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** An epoch-millisecond moment as the reader's locale writes a date and time. */
export const when = (at: number): string => DATE.format(at);

const NUMBER = new Intl.NumberFormat();

export const count = (value: number): string => NUMBER.format(value);

export const plural = (value: number, one: string, many: string): string =>
  `${count(value)} ${value === 1 ? one : many}`;
