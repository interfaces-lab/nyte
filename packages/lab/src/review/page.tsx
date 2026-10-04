/**
 * The Review page: the reviews you made from this repository, grouped by
 * what each needs from you, the open one (or a way to start one), and the
 * dialog that creates them. Everything here reads from real core and real git
 * through the lab's dev server, and moves when either session does: the
 * review's own, and Nyte's on the branch.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type MouseEvent, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph, radius, row } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { ReviewError, useCoreEvents, useRepo, useReview, useReviews, useSessions } from "./api";
import { count } from "./files";
import { NewReview, Start } from "./start";
import { ReviewView } from "./view";
import type { ReviewSummary } from "./wire";

type Group = "progress" | "review" | "approved";

const GROUPS: readonly (readonly [Group, string])[] = [
  ["progress", "In progress"],
  ["review", "Needs your review"],
  ["approved", "Approved"],
];

function groupOf(review: ReviewSummary): Group {
  if (review.approved) return "approved";

  return review.author === "working" || review.guide === "running" || review.guide === "none"
    ? "progress"
    : "review";
}

function GuideMark({ review }: { readonly review: ReviewSummary }): ReactElement {
  if (review.author === "working" || review.guide === "running" || review.guide === "none")
    return (
      <span {...props(styles.mark)}>
        <Spinner />
      </span>
    );

  if (review.guide === "failed")
    return (
      <span {...props(styles.mark, [intent.danger, styles.markTinted])}>
        <Icon name="x" size={12} label="Guide failed" />
      </span>
    );

  return (
    <span {...props(styles.mark)}>
      <Icon name="checkmark" size={12} label="Guide ready" />
    </span>
  );
}

function status(review: ReviewSummary): string {
  if (review.author === "working") return "Nyte is working";

  if (review.guide === "failed") return "Guide failed";

  if (review.guide === "none") return review.files === 0 ? "No commits yet" : "Waiting to update";

  if (review.guide === "running") return review.moved ? "Updating the guide" : "Writing the guide";

  return review.approved ? "Approved" : "Guide ready";
}

/** A plain click opens in place; a modified click is left to the browser, as on any link. */
function follow(event: MouseEvent<HTMLAnchorElement>, open: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;

  event.preventDefault();
  open();
}

export function ReviewPage({
  id,
  onOpen,
}: {
  readonly id: string | undefined;
  readonly onOpen: (id: string | undefined) => void;
}): ReactElement {
  const sessions = useSessions(id);
  const version = useCoreEvents(sessions?.sessionId) + useCoreEvents(sessions?.authorSessionId);
  const reviews = useReviews(version);
  const detail = useReview(id, version);
  const repo = useRepo();

  const [dialog, setDialog] = useState<{
    readonly open: boolean;
    readonly branch: string | undefined;
  }>({ open: false, branch: undefined });

  const offline =
    reviews.error instanceof ReviewError && reviews.error.offline
      ? reviews.error.message
      : undefined;

  const list = reviews.data?.reviews ?? [];
  const startNew = (branch: string | undefined): void => setDialog({ open: true, branch });

  return (
    <div {...props(styles.shell)}>
      <nav aria-label="Reviews" {...props(styles.rail)}>
        <div {...props(styles.railHead)}>
          <h2 {...props(styles.railTitle)}>Reviews</h2>
          <Button
            iconOnly
            icon="plus"
            aria-label="New review"
            disabled={offline !== undefined}
            onClick={() => startNew(undefined)}
          />
        </div>
        {list.length === 0 ? (
          <p {...props(styles.railEmpty)}>
            {reviews.isPending ? "Loading reviews" : "Reviews you create appear here."}
          </p>
        ) : (
          <div {...props(styles.list)}>
            {GROUPS.map(([group, label]) => {
              const members = list.filter((review) => groupOf(review) === group);

              if (members.length === 0) return null;

              return (
                <section key={group} aria-labelledby={`reviews-${group}`} {...props(styles.group)}>
                  <h3 id={`reviews-${group}`} {...props(styles.groupTitle)}>
                    {label}
                    <span {...props(styles.groupCount)}>{count(members.length)}</span>
                  </h3>
                  <ul {...props(styles.items)}>
                    {members.map((review) => (
                      <li key={review.id}>
                        <a
                          href={`/review?id=${encodeURIComponent(review.id)}`}
                          aria-current={review.id === id ? "page" : undefined}
                          onClick={(event) => follow(event, () => onOpen(review.id))}
                          {...props(styles.item)}
                        >
                          <GuideMark review={review} />
                          <span {...props(styles.itemBody)}>
                            <span title={review.title} {...props(styles.itemTitle)}>
                              {review.title}
                            </span>
                            <span {...props(styles.itemMeta)}>
                              <span {...props(styles.itemStatus)}>{status(review)}</span>
                              <span aria-hidden="true">·</span>
                              <span {...props(styles.itemFiles)}>
                                {count(review.files)} {review.files === 1 ? "file" : "files"}
                              </span>
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </nav>
      <main {...props(styles.main)}>
        {id === undefined ? (
          <Start repo={repo.data} offline={offline} onNew={startNew} onStarted={onOpen} />
        ) : detail.data !== undefined ? (
          <ReviewView
            key={detail.data.id}
            review={detail.data}
            root={repo.data?.root ?? ""}
            version={version}
          />
        ) : detail.error !== null ? (
          <div {...props(styles.notice)}>
            <p role="alert" {...props(styles.noticeText)}>
              {detail.error.message}
            </p>
            <Button variant="outline" onClick={() => onOpen(undefined)}>
              Back to reviews
            </Button>
          </div>
        ) : (
          <p role="status" {...props(styles.notice, styles.noticeText)}>
            <Spinner /> Opening the review
          </p>
        )}
      </main>
      <NewReview
        repo={repo.data}
        open={dialog.open}
        initialBranch={dialog.branch}
        onOpenChange={(open) => setDialog({ ...dialog, open })}
        onCreated={(created) => {
          setDialog({ open: false, branch: undefined });
          onOpen(created);
        }}
      />
    </div>
  );
}

const styles = create({
  shell: {
    display: "flex",
    width: "100%",
    height: "100%",
    minHeight: 0,
    backgroundColor: role.sidebarMaterial,
    color: role.contentPrimary,
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    width: 288,
    flexShrink: 0,
    minHeight: 0,
  },
  railHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInline: "16px 8px",
    flexShrink: 0,
  },
  railTitle: {
    flex: 1,
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 600,
  },
  railEmpty: {
    margin: 0,
    paddingInline: 16,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textWrap: "pretty",
  },
  // The lab's page switcher floats over the bottom corner; the list scrolls clear of it.
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    flex: 1,
    minHeight: 0,
    paddingInline: 8,
    paddingBlock: "0 64px",
    overflowY: "auto",
  },
  group: { display: "flex", flexDirection: "column", gap: 4 },
  groupTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    fontWeight: 500,
  },
  groupCount: { fontVariantNumeric: "tabular-nums" },
  items: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minHeight: row.heightLg,
    paddingBlock: 8,
    paddingInline: 8,
    borderRadius: radius.control,
    color: role.contentPrimary,
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      "[aria-current='page']": role.bgInteractiveSecondaryTranslucent,
    },
    // The app's selected row: a translucent fill and a hairline ring.
    boxShadow: {
      default: "none",
      "[aria-current='page']": `inset 0 0 0 1px ${role.borderPrimary}`,
    },
  },
  mark: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.sm,
    height: "1lh",
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  markTinted: { color: role.contentInteractiveTertiary },
  itemBody: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  itemTitle: {
    overflow: "hidden",
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemMeta: {
    display: "flex",
    gap: 6,
    minWidth: 0,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  itemStatus: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemFiles: { flexShrink: 0, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  main: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
  },
  notice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
    margin: 0,
    padding: 28,
  },
  noticeText: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    color: role.contentSecondary,
  },
});
