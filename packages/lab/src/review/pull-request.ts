/**
 * The pull request a review stands for, faked. The lab never pushes, so
 * nothing exists on GitHub. The number comes from the review's hex id and holds
 * across reloads; a branch Nyte is still writing reads as a draft.
 */
import type { ReviewDetail } from "./wire";

export function pullRequestNumber(id: string): number {
  return (Number.parseInt(id.slice(0, 6), 16) % 900) + 100;
}

/** Nyte, for a branch it built from a chat; otherwise whoever wrote the newest commit. */
export function openerOf(review: ReviewDetail): string {
  return review.task === undefined ? (review.commits[0]?.author ?? "You") : "Nyte";
}
