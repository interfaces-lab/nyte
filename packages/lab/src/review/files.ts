/**
 * What the review demo derives from a review: files ready for Pierre, guide
 * sections expanded to the files they cover, and how numbers and dates read.
 */
import { parsePatch, type ReviewFile } from "./code";
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

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** An epoch-millisecond moment as the reader's locale writes a date and time. */
export const when = (at: number): string => DATE.format(at);

const NUMBER = new Intl.NumberFormat();

export const count = (value: number): string => NUMBER.format(value);

export const plural = (value: number, one: string, many: string): string =>
  `${count(value)} ${value === 1 ? one : many}`;
