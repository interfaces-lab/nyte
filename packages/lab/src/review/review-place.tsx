/**
 * A pull request's page. Its toolbar switches between three views of the one
 * pull request; a switch replaces the entry rather than adding a step to Back:
 * - Overview, where it opens: the pull request at a glance, drawn from the
 *   review alone, with no patch loaded and no model called.
 * - Guide: the change told section by section beside its code. A guide is
 *   written only when you press Write Guide or Update; opening a view never
 *   calls the model.
 * - Diff: every file, with the tree and the commit picker.
 * The toolbar holds the views on the left, and on the right where the pull
 * request stands, your progress, Ask and Approve, the same in every view. Ask
 * opens the side chat beside whichever view is showing; it is part of the
 * page, never a chat or a pane of its own.
 */
import { create, props } from "@stylexjs/stylex";
import { useRef, useState, type ReactElement } from "react";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useApprove, useLiveReview, useWriteGuide } from "./api";
import { DiffStack } from "./diff-stack";
import { count, plural, sectionFiles } from "./files";
import {
  ReviewGuide,
  sectionNumber,
  type GuideFiles,
  type GuideNavigation,
  type GuideWriting,
} from "./guide";
import { ReviewOverview } from "./overview";
import { openerOf, pullRequestNumber } from "./pull-request";
import { useReviewState } from "./review-state";
import { briefsOf, useReviewFiles } from "./use-review-files";
import { SideChat } from "./side-chat";
import type { ReviewView } from "./window";
import type { ReviewDetail } from "./wire";

export interface DiffSettings {
  readonly layout: "unified" | "split";
  readonly tree: boolean;
}

interface Navigation {
  readonly view: ReviewView;
  readonly diff: DiffSettings;
  readonly onView: (view: ReviewView) => void;
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
            <Spinner /> Opening the pull request
          </>
        ) : (
          review.error.message
        )}
      </p>
    );

  return <ReviewDocument review={review.data} version={version} {...navigation} />;
}

/** Every file of the pull request with the tree and the commit picker: the Diff view, and the workbench. */
export function ReviewDiff({
  review,
  settings,
  reveal,
}: {
  readonly review: ReviewDetail;
  readonly settings: DiffSettings;
  /** A file to reveal on mount; mount with a new `key` to reveal another. */
  readonly reveal: string | undefined;
}): ReactElement {
  const data = useReviewFiles(review);
  const local = useReviewState(review.id, data.files);
  const [commit, setCommit] = useState<string | undefined>(undefined);

  if (data.empty) return <p {...props(styles.note)}>No commits yet.</p>;

  if (data.error !== null)
    return (
      <p role="alert" {...props(styles.note)}>
        {data.error.message}
      </p>
    );

  if (data.loading)
    return (
      <p role="status" {...props(styles.note)}>
        <Spinner /> Loading changes
      </p>
    );

  return (
    <DiffStack
      files={data.files}
      commits={review.commits.map((entry) => ({ oid: entry.short, subject: entry.subject }))}
      commit={commit}
      onCommit={setCommit}
      layout={settings.layout}
      treeVisible={settings.tree}
      reviewed={local.reviewed}
      onReviewed={local.setReviewed}
      collapsed={(path) => local.collapsed(path, local.reviewed(path) === "reviewed")}
      onToggle={(path) => local.toggle(path, local.reviewed(path) === "reviewed")}
      justUpdated={(path) => data.updated.has(path) && local.reviewed(path) !== "reviewed"}
      reveal={reveal}
      onReference={local.addReference}
    />
  );
}

/** Title, who opened it, its state and number, and the branches it joins. */
export function PullRequestHeader({ review }: { readonly review: ReviewDetail }): ReactElement {
  const { files } = review;

  const draft = review.author?.status === "working";
  const opener = openerOf(review);
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);

  return (
    <header {...props(styles.header)}>
      <h1 {...props(styles.title)}>{review.title}</h1>
      <div {...props(styles.meta)}>
        <span {...props(styles.person)}>
          <Avatar size="xs">
            <AvatarFallback>{opener.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          {opener}
        </span>
        <span {...props(!draft && intent.success, styles.state)}>
          <Icon name={draft ? "draft" : "pull-request"} size={12} />
          {draft ? "Draft" : "Open"}
        </span>
        <span>#{pullRequestNumber(review.id)}</span>
        <span translate="no" {...props(styles.refs)}>
          {review.baseRef}
          <span aria-label="from" {...props(styles.arrow)}>
            ←
          </span>
          {review.headRef}
        </span>
        <span aria-hidden="true">·</span>
        <span>{plural(files.length, "file", "files")}</span>
        <span {...props(styles.counts)}>
          <span {...props([intent.success, styles.added])}>+{count(added)}</span>
          <span {...props([intent.danger, styles.removed])}>−{count(removed)}</span>
        </span>
      </div>
    </header>
  );
}

/** The Guide: the only view that loads every patch, and the only one that can spend on a guide. */
function GuideView({
  review,
  version,
  navigation,
  writing,
  onOpenInDiff,
}: {
  readonly review: ReviewDetail;
  readonly version: number;
  readonly navigation: GuideNavigation;
  readonly writing: GuideWriting;
  readonly onOpenInDiff: (path: string) => void;
}): ReactElement {
  const data = useReviewFiles(review);
  const local = useReviewState(review.id, data.files);

  const input: GuideFiles = {
    files: data.files,
    reviewed: local.reviewed,
    onReviewed: (path, next) => local.setReviewed([path], next),
    collapsed: local.collapsed,
    onToggle: local.toggle,
    justUpdated: (path) => data.updated.has(path) && local.reviewed(path) !== "reviewed",
    onOpenInDiff,
    onReference: local.addReference,
  };

  return (
    <ReviewGuide
      review={review}
      current={data.current}
      shown={data.shown}
      version={version}
      input={input}
      header={<PullRequestHeader review={review} />}
      navigation={navigation}
      writing={writing}
      onAsk={(section) => local.compose(`About “${section}”: `)}
    />
  );
}

function ReviewDocument({
  review,
  version,
  view,
  diff,
  onView,
}: Navigation & { readonly review: ReviewDetail; readonly version: number }): ReactElement {
  const local = useReviewState(review.id, review.files);
  const { empty, current, shown } = briefsOf(review);
  const write = useWriteGuide(review.id);
  const approve = useApprove(review.id);
  const [inView, setInView] = useState(0);

  const [reveal, setReveal] = useState<{
    readonly path: string | undefined;
    readonly count: number;
  }>({ path: undefined, count: 0 });

  const bands = useRef(new Map<number, HTMLElement>());
  /** A section the Overview asked for, scrolled to when the guide draws its band. */
  const opening = useRef<number | undefined>(undefined);
  const approved = review.approvals.at(-1)?.head === review.revision.head;
  const draft = review.author?.status === "working";
  const sections = shown?.guide.sections ?? [];
  const total = review.files.length;

  const writing: GuideWriting = {
    onWrite: () => write.mutate({ head: review.revision.head }),
    requesting: write.isPending,
  };

  const reviewedIn = (index: number): string => {
    const section = sections[index];

    if (section === undefined) return "";

    const files = sectionFiles(section, review.files);
    const done = files.filter((file) => local.reviewed(file.path) === "reviewed").length;

    return done === files.length ? "Reviewed" : `${done}/${files.length}`;
  };

  const openSection = (index: number): void => {
    const band = bands.current.get(index);

    if (band !== undefined) {
      band.scrollIntoView({ block: "start", behavior: "smooth" });

      return;
    }

    opening.current = index;
    onView("guide");
  };

  const navigation: GuideNavigation = {
    onInView: setInView,
    onBand: (index, node) => {
      if (node === null) {
        bands.current.delete(index);

        return;
      }

      bands.current.set(index, node);

      if (opening.current !== index) return;

      opening.current = undefined;
      node.scrollIntoView({ block: "start" });
    },
  };

  const reading = sections[inView];

  return (
    <div {...props(styles.page)}>
      <div {...props(styles.toolbar)}>
        <ToggleGroup
          aria-label="View"
          value={[view]}
          onValueChange={(values) => {
            const next = values.at(-1);

            if (next !== undefined) onView(next);
          }}
        >
          <Toggle value="overview">Overview</Toggle>
          <Toggle value="guide">
            Guide
            {sections.length > 0 && <span {...props(styles.tally)}>{sections.length}</span>}
          </Toggle>
          <Toggle value="diff">
            Diff<span {...props(styles.tally)}>{count(total)}</span>
          </Toggle>
        </ToggleGroup>
        {view === "guide" && reading !== undefined && (
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" xstyle={styles.reading}>
                  <span {...props(styles.readingNumber)}>
                    {sectionNumber(inView)}/{sectionNumber(sections.length - 1)}
                  </span>
                  <span {...props(styles.readingTitle)}>{reading.title}</span>
                  <Icon name="chevron-up-down" size={12} />
                </Button>
              }
            />
            <MenuContent align="start">
              <MenuRadioGroup
                value={String(inView)}
                onValueChange={(value) => openSection(Number(value))}
              >
                {sections.map((section, index) => (
                  <MenuRadioItem
                    key={section.title}
                    value={String(index)}
                    meta={<span {...props(styles.menuMeta)}>{reviewedIn(index)}</span>}
                  >
                    {sectionNumber(index)} {section.title}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}
        <span {...props(styles.spacer)} />
        <span {...props(!draft && !approved && intent.success, styles.barState)}>
          <Icon
            name={approved ? "checkmark" : draft ? "draft" : "pull-request"}
            size={14}
            xstyle={styles.barIcon}
          />
          {approved ? "Approved" : draft ? "Draft" : "Open"}
        </span>
        <span {...props(styles.barNote)}>
          {draft
            ? "Nyte is working on it"
            : `${count(local.reviewedCount)} of ${plural(total, "file", "files")} reviewed`}
        </span>
        {total > 0 && !draft && (
          <span aria-hidden="true" {...props(styles.meter)}>
            <span {...props(styles.meterFill(`${(local.reviewedCount / total) * 100}%`))} />
          </span>
        )}
        <Toggle icon="bubble-question" pressed={local.side} onPressedChange={local.setSide}>
          Ask
        </Toggle>
        <Button
          variant={approved ? "outline" : "solid"}
          tone={approved ? undefined : "primary"}
          icon={approved ? "checkmark" : undefined}
          disabled={empty || approved}
          loading={approve.isPending}
          onClick={() => approve.mutate({ head: review.revision.head })}
        >
          {approved ? "Approved" : "Approve"}
        </Button>
      </div>
      <div {...props(styles.body)}>
        <div {...props(styles.view)}>
          {view === "overview" && (
            <ReviewOverview
              review={review}
              current={current}
              shown={shown}
              reviewed={local.reviewed}
              reviewedCount={local.reviewedCount}
              writing={writing}
              onOpenGuide={() => onView("guide")}
              onOpenSection={openSection}
            />
          )}
          {view === "guide" && (
            <GuideView
              review={review}
              version={version}
              navigation={navigation}
              writing={writing}
              onOpenInDiff={(path) => {
                setReveal({ path, count: reveal.count + 1 });
                onView("diff");
              }}
            />
          )}
          {view === "diff" && (
            <ReviewDiff key={reveal.count} review={review} settings={diff} reveal={reveal.path} />
          )}
        </div>
        {local.side && <SideChat review={review} version={version} writing={writing} />}
      </div>
    </div>
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
  page: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 },
  toolbar: {
    containerType: "inline-size",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingBlock: 8,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  tally: {
    marginInlineStart: 6,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  reading: { flexShrink: 1, minWidth: 0, maxWidth: 360 },
  readingNumber: {
    flexShrink: 0,
    marginInlineEnd: 4,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  // In a narrow pane the toolbar keeps the section's number and drops its title.
  readingTitle: {
    display: { default: "inline", "@container (max-width: 600px)": "none" },
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menuMeta: { color: role.contentSecondary, fontVariantNumeric: "tabular-nums" },
  spacer: { flex: 1 },
  barState: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    fontWeight: 500,
  },
  barIcon: { color: role.contentSecondary },
  barNote: {
    display: { default: "inline", "@container (max-width: 760px)": "none" },
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meter: {
    display: { default: "block", "@container (max-width: 760px)": "none" },
    marginInlineEnd: 8,
    width: 56,
    height: 4,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveSecondary,
  },
  meterFill: (share: string) => ({
    display: "block",
    inlineSize: share,
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  }),
  body: { display: "flex", flex: 1, minHeight: 0 },
  view: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  header: { display: "flex", flexDirection: "column", gap: 10 },
  title: {
    margin: 0,
    maxWidth: "48ch",
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: 1.25,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    textWrap: "balance",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 8,
    rowGap: 4,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  person: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentPrimary,
    fontWeight: 500,
  },
  state: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingInline: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontWeight: 500,
  },
  refs: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    overflowWrap: "anywhere",
  },
  arrow: { color: role.contentDisabled },
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
