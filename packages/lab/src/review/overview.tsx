/**
 * The Overview, where a pull request opens: everything about it that costs
 * nothing to show. It reads the review alone, with no patch and no model call,
 * so it draws as soon as the pull request is known:
 * - the title and the branches it joins;
 * - its properties: branch, status, your review, the guide, commits, where
 *   Nyte works on it;
 * - what it says: the task Nyte was given, or the commit message;
 * - the guide's sections as contents, once a guide exists;
 * - what has happened since it opened.
 * The guide is written only when you press Write Guide or Update, here or in
 * the Guide.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { glyph, radius, row } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import type { ReviewedState } from "./code";
import { count, plural, sectionFiles, when } from "./files";
import { sectionNumber, type GuideWriting } from "./guide";
import { openerOf, pullRequestNumber } from "./pull-request";
import type { ShownBrief } from "./use-review-files";
import type { Brief, ReviewDetail } from "./wire";

interface Happening {
  readonly key: string;
  readonly at: number;
  readonly icon: IconName;
  readonly text: ReactNode;
}

const short = (oid: string): string => oid.slice(0, 7);

/** Past this many commits the activity names the run of them instead of each one. */
const LISTED_COMMITS = 8;

/** Commit messages are hard-wrapped: rejoin each paragraph, keeping list items on their own lines. */
function paragraphsOf(text: string): readonly string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .reduce((joined, line) =>
          /^([-*•]|\d+\.)\s/.test(line) ? `${joined}\n${line}` : `${joined} ${line}`,
        )
        .trim(),
    )
    .filter((paragraph) => paragraph !== "");
}

function activityOf(review: ReviewDetail): readonly Happening[] {
  const opener = openerOf(review);

  const [newest] = review.commits;

  const commits: readonly Happening[] =
    review.commits.length > LISTED_COMMITS && newest !== undefined
      ? [
          {
            key: "commits",
            at: newest.at,
            icon: "git",
            text: (
              <>
                {count(review.commits.length)} commits, the newest{" "}
                <code {...props(styles.sha)}>{newest.short}</code> {newest.subject}
              </>
            ),
          },
        ]
      : review.commits.map((commit) => ({
          key: `commit-${commit.oid}`,
          at: commit.at,
          icon: "git" as const,
          text: (
            <>
              <code {...props(styles.sha)}>{commit.short}</code> {commit.subject}
            </>
          ),
        }));

  return [
    ...commits,
    {
      key: "opened",
      at: review.createdAt,
      icon: "pull-request" as const,
      text: `${opener} opened the pull request`,
    },
    ...review.briefs.flatMap((brief) =>
      brief.status === "done" && brief.doneAt !== undefined
        ? [
            {
              key: `guide-${brief.head}`,
              at: brief.doneAt,
              icon: "sparkle" as const,
              text: `${brief.from === undefined ? "Guide written" : "Guide updated"} for ${short(brief.head)}`,
            },
          ]
        : [],
    ),
    ...review.approvals.map((approval) => ({
      key: `approved-${approval.head}-${approval.at}`,
      at: approval.at,
      icon: "checkmark" as const,
      text: `You approved ${short(approval.head)}`,
    })),
  ].toSorted((left, right) => left.at - right.at);
}

function Property({
  icon,
  label,
  children,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.property)}>
      <dt {...props(styles.propertyLabel)}>
        <Icon name={icon} size={14} xstyle={styles.propertyIcon} />
        {label}
      </dt>
      <dd {...props(styles.propertyValue)}>{children}</dd>
    </div>
  );
}

/** The guide's row: what exists for this head, and the one button that would spend on it. */
function GuideState({
  review,
  current,
  shown,
  writing,
  onOpen,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: ShownBrief | undefined;
  readonly writing: GuideWriting;
  readonly onOpen: () => void;
}): ReactElement {
  if (review.revision.head === review.revision.base) return <>No commits yet</>;

  if (current?.status === "running" || (current === undefined && writing.requesting))
    return (
      <span {...props(styles.inline)}>
        <Spinner /> {shown === undefined ? "Writing" : "Updating from the interdiff"}
      </span>
    );

  if (current?.status === "failed")
    return (
      <span {...props(styles.inline)}>
        Failed for {short(review.revision.head)}
        <Button variant="outline" size="sm" onClick={writing.onWrite}>
          Try Again
        </Button>
      </span>
    );

  if (current === undefined)
    return (
      <span {...props(styles.inline)}>
        {shown === undefined
          ? "Not written"
          : `${plural(
              Math.max(
                review.commits.findIndex((commit) => commit.oid === shown.head),
                1,
              ),
              "commit",
              "commits",
            )} behind`}
        <Button variant="outline" size="sm" onClick={writing.onWrite}>
          {shown === undefined ? "Write Guide" : "Update"}
        </Button>
      </span>
    );

  return (
    <span {...props(styles.inline)}>
      {plural(shown?.guide.sections.length ?? 0, "section", "sections")} for{" "}
      {short(review.revision.head)}
      <Button variant="ghost" size="sm" onClick={onOpen}>
        Open
      </Button>
    </span>
  );
}

export function ReviewOverview({
  review,
  current,
  shown,
  reviewed,
  reviewedCount,
  writing,
  onOpenGuide,
  onOpenSection,
}: {
  readonly review: ReviewDetail;
  readonly current: Brief | undefined;
  readonly shown: ShownBrief | undefined;
  readonly reviewed: (path: string) => ReviewedState;
  readonly reviewedCount: number;
  readonly writing: GuideWriting;
  readonly onOpenGuide: () => void;
  readonly onOpenSection: (index: number) => void;
}): ReactElement {
  const opener = openerOf(review);
  const draft = review.author?.status === "working";
  const approval = review.approvals.at(-1);
  const approved = approval?.head === review.revision.head;
  const added = review.files.reduce((sum, file) => sum + file.added, 0);
  const removed = review.files.reduce((sum, file) => sum + file.removed, 0);

  const description =
    review.task ?? review.commits.findLast((commit) => commit.body !== "")?.body ?? "";

  return (
    <div {...props(styles.scroll)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>
            {review.title} <span {...props(styles.number)}>#{pullRequestNumber(review.id)}</span>
          </h1>
          <p {...props(styles.byline)}>
            <span {...props(!draft && intent.success, styles.state)}>
              <Icon name={draft ? "draft" : "pull-request"} size={12} />
              {draft ? "Draft" : "Open"}
            </span>
            <span {...props(styles.person)}>
              <Avatar size="xs">
                <AvatarFallback>{opener.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              {opener}
            </span>
            wants to merge {plural(review.commits.length, "commit", "commits")} into
            <code {...props(styles.ref)}>{review.baseRef}</code>
            from
            <code {...props(styles.ref)}>{review.headRef}</code>
          </p>
        </header>

        <dl {...props(styles.properties)}>
          <Property icon="git-branch" label="Branch">
            <span {...props(styles.inline)}>
              <code {...props(styles.mono)}>{review.headRef}</code>
              <Icon name="chevron-right" size={12} xstyle={styles.quiet} />
              <code {...props(styles.mono)}>{review.baseRef}</code>
              <span {...props(styles.counts)}>
                <span {...props([intent.success, styles.added])}>+{count(added)}</span>
                <span {...props([intent.danger, styles.removed])}>−{count(removed)}</span>
              </span>
            </span>
          </Property>
          <Property icon="status" label="Status">
            {draft
              ? "Draft · Nyte is working on it"
              : review.author?.status === "failed"
                ? `Open · Nyte stopped${review.author.failure === undefined ? "" : `: ${review.author.failure}`}`
                : "Open"}
          </Property>
          <Property icon="user" label="Reviewer">
            {approved && approval !== undefined
              ? `You · Approved ${when(approval.at)}`
              : `You · ${count(reviewedCount)} of ${plural(review.files.length, "file", "files")} reviewed`}
          </Property>
          <Property icon="sparkle" label="Guide">
            <GuideState
              review={review}
              current={current}
              shown={shown}
              writing={writing}
              onOpen={onOpenGuide}
            />
          </Property>
          <Property icon="git" label="Commits">
            {plural(review.commits.length, "commit", "commits")}
          </Property>
          {(review.author !== undefined || review.blocked !== undefined) && (
            <Property icon="agent" label="Nyte">
              {review.author === undefined ? (
                review.blocked
              ) : (
                <code {...props(styles.mono)} title={review.author.worktree}>
                  {review.author.worktree}
                </code>
              )}
            </Property>
          )}
        </dl>

        <article {...props(styles.card)}>
          <header {...props(styles.cardHeader)}>
            <span {...props(styles.person)}>
              <Avatar size="xs">
                <AvatarFallback>{opener.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              {opener}
            </span>
            <span {...props(styles.quiet)}>
              {review.task === undefined ? "opened this pull request" : "asked Nyte"} ·{" "}
              {when(review.createdAt)}
            </span>
          </header>
          <div {...props(styles.cardBody)}>
            {description === "" ? (
              <p {...props(styles.quiet, styles.paragraph)}>No description.</p>
            ) : (
              paragraphsOf(description).map((paragraph) => (
                <p key={paragraph} {...props(styles.paragraph)}>
                  {paragraph}
                </p>
              ))
            )}
          </div>
        </article>

        {shown !== undefined && (
          <section aria-labelledby={`${review.id}-contents`} {...props(styles.block)}>
            <h2 id={`${review.id}-contents`} {...props(styles.blockTitle)}>
              In this change
              {shown.head !== review.revision.head && (
                <span {...props(styles.quiet)}> · as of {short(shown.head)}</span>
              )}
            </h2>
            <ol {...props(styles.contents)}>
              {shown.guide.sections.map((section, index) => {
                const files = sectionFiles(section, review.files);
                const done = files.filter((file) => reviewed(file.path) === "reviewed").length;

                return (
                  <li key={section.title}>
                    <button
                      type="button"
                      onClick={() => onOpenSection(index)}
                      {...props(styles.entry)}
                    >
                      <span {...props(styles.entryNumber)}>{sectionNumber(index)}</span>
                      <span {...props(styles.entryBody)}>
                        <span {...props(styles.entryTitle)}>{section.title}</span>
                        <span {...props(styles.entrySummary)}>{section.explanation}</span>
                      </span>
                      <span {...props(styles.entryProgress)}>
                        {done === files.length ? (
                          <Icon name="checkmark" size={14} label="Reviewed" />
                        ) : (
                          `${done}/${files.length}`
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section aria-labelledby={`${review.id}-activity`} {...props(styles.block)}>
          <h2 id={`${review.id}-activity`} {...props(styles.blockTitle)}>
            Activity
          </h2>
          <ol {...props(styles.timeline)}>
            {activityOf(review).map((happening) => (
              <li key={happening.key} {...props(styles.happening)}>
                <span aria-hidden="true" {...props(styles.marker)}>
                  <Icon name={happening.icon} size={12} />
                </span>
                <span {...props(styles.happeningText)}>{happening.text}</span>
                <span {...props(styles.quiet, styles.happeningAt)}>{when(happening.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

const styles = create({
  scroll: { flex: 1, minHeight: 0, overflowY: "auto", paddingInline: 32, paddingBlockEnd: 48 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 28,
    maxWidth: 720,
    marginInline: "auto",
    paddingBlockStart: 32,
  },
  header: { display: "flex", flexDirection: "column", gap: 10 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.25,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    textWrap: "balance",
  },
  number: { color: role.contentSecondary, fontWeight: 400 },
  byline: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 6,
    rowGap: 6,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  state: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingInline: 8,
    paddingBlock: 2,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontWeight: 500,
  },
  person: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentPrimary,
    fontWeight: 500,
  },
  ref: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
  },
  properties: { display: "flex", flexDirection: "column", gap: 2, margin: 0 },
  property: {
    display: "grid",
    gridTemplateColumns: "140px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: 16,
    minHeight: row.heightMd,
  },
  propertyLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  propertyIcon: { flexShrink: 0 },
  propertyValue: {
    minWidth: 0,
    margin: 0,
    overflow: "hidden",
    color: role.contentPrimary,
    fontSize: type.fontSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  inline: { display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 },
  mono: { fontFamily: type.fontMono, fontSize: type.fontXs },
  quiet: { color: role.contentSecondary },
  counts: {
    display: "inline-flex",
    gap: 6,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
  card: {
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 10,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgMutedTranslucent,
    fontSize: type.fontSm,
  },
  cardBody: { display: "flex", flexDirection: "column", gap: 12, padding: 16 },
  paragraph: {
    margin: 0,
    maxWidth: "68ch",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingLg,
    whiteSpace: "pre-line",
    textWrap: "pretty",
  },
  block: { display: "flex", flexDirection: "column", gap: 10 },
  blockTitle: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 600,
  },
  contents: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  entry: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    width: "100%",
    paddingBlock: 12,
    paddingInline: 16,
    borderStyle: "none",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentPrimary,
    font: "inherit",
    textAlign: "start",
    cursor: appearance.cursorInteractive,
  },
  entryNumber: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
  },
  entryBody: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  entryTitle: { fontSize: type.fontBase, lineHeight: type.leadingBase, fontWeight: 500 },
  entrySummary: {
    display: "-webkit-box",
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  entryProgress: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
  },
  timeline: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  happening: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: row.heightMd,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  marker: {
    display: "inline-grid",
    placeItems: "center",
    width: glyph.lg,
    height: glyph.lg,
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  },
  happeningText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  happeningAt: { flexShrink: 0, whiteSpace: "nowrap" },
  sha: { color: role.contentSecondary, fontFamily: type.fontMono, fontSize: type.fontXs },
});
