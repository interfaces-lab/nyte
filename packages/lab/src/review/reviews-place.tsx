/**
 * The Review page, opened from the sidebar: every pull request waiting on you,
 * newest first. A row opens its review in place; a modified click opens it in
 * a background tab. Branches you wrote yourself get a pull request from
 * "Review a Branch".
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type MouseEvent, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useRepo } from "./api";
import { targetOf } from "./chat-place";
import { count, plural, when } from "./files";
import { NewReview } from "./new-review";
import { pullRequestNumber } from "./pull-request";
import type { OpenTarget, Place } from "./window";
import type { ReviewSummary } from "./wire";

function statusOf(review: ReviewSummary): string | undefined {
  if (review.author === "working") return "Nyte is working";

  if (review.author === "failed") return "Nyte stopped";

  if (review.commits === 0) return "No commits";

  if (review.guide === "running") return "Writing the guide";

  if (review.guide === "failed") return "Guide failed";

  if (review.approved) return "Approved";

  return review.moved ? "New commits" : undefined;
}

function PullRequestRow({
  review,
  onOpen,
}: {
  readonly review: ReviewSummary;
  readonly onOpen: (place: Place, target: OpenTarget) => void;
}): ReactElement {
  const draft = review.author === "working";
  const status = statusOf(review);

  const open = (event: MouseEvent, target: OpenTarget): void => {
    event.preventDefault();
    onOpen({ kind: "review", reviewId: review.id }, target);
  };

  return (
    <li>
      <a
        href={`/review?id=${encodeURIComponent(review.id)}`}
        onClick={(event) => open(event, targetOf(event))}
        onAuxClick={(event) => {
          if (event.button === 1) open(event, "background");
        }}
        {...props(styles.row)}
      >
        <Icon
          name={draft ? "draft" : "pull-request"}
          size={16}
          label={draft ? "Draft" : "Open"}
          xstyle={[!draft && intent.success, styles.state]}
        />
        <span {...props(styles.body)}>
          <span {...props(styles.title)}>{review.title}</span>
          <span {...props(styles.meta)}>
            <span>#{pullRequestNumber(review.id)}</span>
            <span aria-hidden="true">·</span>
            <span translate="no" {...props(styles.branch)}>
              {review.headRef}
            </span>
            <span aria-hidden="true">·</span>
            <span>{plural(review.commits, "commit", "commits")}</span>
            <span aria-hidden="true">·</span>
            <span>{when(review.createdAt)}</span>
          </span>
        </span>
        <span {...props(styles.trailing)}>
          {status !== undefined && (
            <span {...props(styles.status)}>
              {review.guide === "running" || review.author === "working" ? (
                <Spinner />
              ) : (
                review.approved && <Icon name="checkmark" size={12} />
              )}
              {status}
            </span>
          )}
          <span {...props(styles.counts)}>
            <span {...props([intent.success, styles.added])}>+{count(review.added)}</span>
            <span {...props([intent.danger, styles.removed])}>−{count(review.removed)}</span>
          </span>
        </span>
      </a>
    </li>
  );
}

export function ReviewsPlace({
  reviews,
  loading,
  onOpen,
}: {
  readonly reviews: readonly ReviewSummary[];
  readonly loading: boolean;
  readonly onOpen: (place: Place, target: OpenTarget) => void;
}): ReactElement {
  const repo = useRepo();
  const [creating, setCreating] = useState(false);
  const newest = reviews.toSorted((left, right) => right.createdAt - left.createdAt);

  return (
    <div {...props(styles.scroll)}>
      <div {...props(styles.page)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.heading)}>Review</h1>
          <Button variant="outline" icon="git-branch" onClick={() => setCreating(true)}>
            Review a Branch
          </Button>
        </header>
        {loading && reviews.length === 0 ? (
          <p role="status" {...props(styles.note)}>
            <Spinner /> Loading pull requests
          </p>
        ) : newest.length === 0 ? (
          <p {...props(styles.note)}>Nothing to review.</p>
        ) : (
          <ul aria-label="Pull requests" {...props(styles.list)}>
            {newest.map((review) => (
              <PullRequestRow key={review.id} review={review} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
      <NewReview
        repo={repo.data}
        open={creating}
        initialBranch={undefined}
        onOpenChange={setCreating}
        onCreated={(reviewId) => {
          setCreating(false);
          onOpen({ kind: "review", reviewId }, "here");
        }}
      />
    </div>
  );
}

const styles = create({
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "min(760px, calc(100% - 56px))",
    marginInline: "auto",
    paddingBlock: "32px 96px",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heading: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: type.letterLg,
  },
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    color: role.contentSecondary,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    paddingBlock: 12,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentPrimary,
    textDecoration: "none",
  },
  state: { flexShrink: 0, marginBlockStart: 2, color: role.contentSecondary },
  body: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 },
  title: {
    overflow: "hidden",
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  branch: { minWidth: 0, overflow: "hidden", fontFamily: type.fontMono, textOverflow: "ellipsis" },
  trailing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  counts: {
    display: "inline-flex",
    gap: 6,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
});
