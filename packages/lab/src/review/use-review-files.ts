/**
 * What every surface of one review derives the same way: the head's files
 * ready for Pierre, the guide on screen (the head's own, or an earlier head's
 * while the next is written by interdiff), and which files changed since that
 * guide, so they can say "Just updated".
 */
import { useMemo } from "react";
import { usePatches } from "./api";
import { reviewFiles } from "./files";
import type { Brief, Guide, ReviewDetail } from "./wire";

export type ShownBrief = Brief & { readonly guide: Guide };

const withGuide = (brief: Brief | undefined): brief is ShownBrief => brief?.guide !== undefined;

export function useReviewFiles(review: ReviewDetail) {
  const { revision } = review;
  const empty = revision.head === revision.base;
  const current = review.briefs.find((brief) => brief.head === revision.head);

  const shown = withGuide(current)
    ? current
    : review.revisions
        .filter((entry) => entry.base === revision.base)
        .map((entry) => review.briefs.find((brief) => brief.head === entry.head))
        .findLast(withGuide);

  // Since the guide's own head when it is behind, else since the brief it was cut from.
  const since =
    shown === undefined ? undefined : shown.head === revision.head ? shown.from : shown.head;

  const all = usePatches(review.id, empty ? undefined : revision.base, revision.head);
  const moved = usePatches(review.id, since, since === undefined ? undefined : revision.head);

  const files = useMemo(
    () => reviewFiles(all.data?.patches ?? [], revision.base, revision.head),
    [all.data, revision.base, revision.head],
  );

  const updated = new Set(
    (moved.data?.patches ?? []).filter((entry) => entry.patch !== "").map((entry) => entry.path),
  );

  return {
    empty,
    current,
    shown,
    files,
    updated,
    loading: all.isPending && !empty,
    error: all.error,
  };
}
