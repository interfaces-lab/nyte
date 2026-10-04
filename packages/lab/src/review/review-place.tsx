/**
 * A pull request's review page: one document, not a second row of tabs. It
 * opens on what the change is and where it stands, then the guide. The full
 * diff lives in the workbench, opened from the tab area; the chat is a place
 * of its own, split beside this one when you ask about a section or attach
 * code.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useApprove, useLiveReview } from "./api";
import { count } from "./files";
import { ReviewGuide, type GuideFiles } from "./guide";
import { useReviewState } from "./review-state";
import { useReviewFiles } from "./use-review-files";
import type { OpenTarget, Place } from "./window";
import type { ReviewDetail } from "./wire";

interface Navigation {
  readonly onOpen: (place: Place, target: OpenTarget) => void;
  /** Open the workbench's diff on `path`. */
  readonly onShowDiff: (path: string) => void;
}

export function ReviewPlace({
  reviewId,
  ...navigation
}: Navigation & { readonly reviewId: string }): ReactElement {
  const { review, version } = useLiveReview(reviewId);

  if (review.data === undefined)
    return (
      <p role="status" {...props(styles.note)}>
        {review.error === null ? (
          <>
            <Spinner /> Opening the review
          </>
        ) : (
          review.error.message
        )}
      </p>
    );

  return <ReviewDocument review={review.data} version={version} {...navigation} />;
}

function ReviewDocument({
  review,
  version,
  onOpen,
  onShowDiff,
}: Navigation & { readonly review: ReviewDetail; readonly version: number }): ReactElement {
  const data = useReviewFiles(review);
  const local = useReviewState(review.id, data.files);
  const approve = useApprove(review.id);
  const approved = review.approvals.at(-1)?.head === review.revision.head;
  const chat: Place = { kind: "chat", reviewId: review.id };
  const total = data.files.length;

  const input: GuideFiles = {
    files: data.files,
    reviewed: local.reviewed,
    onReviewed: (path, next) => local.setReviewed([path], next),
    collapsed: local.collapsed,
    onToggle: local.toggle,
    justUpdated: (path) => data.updated.has(path) && local.reviewed(path) !== "reviewed",
    onOpenInDiff: onShowDiff,
    onReference: (reference) => {
      local.addReference(reference);
      onOpen(chat, "beside");
    },
  };

  return (
    <ReviewGuide
      review={review}
      current={data.current}
      shown={data.shown}
      version={version}
      input={input}
      onAsk={(section) => {
        local.compose(`About “${section}”: `);
        onOpen(chat, "beside");
      }}
      actions={
        <>
          {total > 0 && (
            <span {...props(styles.progress)}>
              <span {...props(styles.progressText)}>
                {count(local.reviewedCount)} of {count(total)} reviewed
              </span>
              <span aria-hidden="true" {...props(styles.meter)}>
                <span {...props(styles.meterFill(`${(local.reviewedCount / total) * 100}%`))} />
              </span>
            </span>
          )}
          <Button
            variant={approved ? "outline" : "solid"}
            tone={approved ? undefined : "primary"}
            icon={approved ? "checkmark" : undefined}
            disabled={data.empty || approved}
            loading={approve.isPending}
            onClick={() => approve.mutate({ head: review.revision.head })}
          >
            {approved ? "Approved" : "Approve"}
          </Button>
        </>
      }
    />
  );
}

const styles = create({
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: 28,
    color: role.contentSecondary,
  },
  progress: { display: "inline-flex", alignItems: "center", gap: 8 },
  progressText: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  meter: {
    display: "block",
    width: 64,
    height: 4,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
  meterFill: (share: string) => ({
    display: "block",
    inlineSize: share,
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  }),
});
