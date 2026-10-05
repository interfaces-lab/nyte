/**
 * The side chat: questions asked beside the pull request, without leaving it
 * and without becoming a chat. It is not a place, has no tab and is not
 * listed anywhere; the toolbar's Ask opens and closes it on every view.
 *
 * Each thread is a fork of the guide's brief, cut by its first question. The
 * fork starts from everything the brief already read, so an answer pays for
 * the question, not for reading the change again. That reuse is what this
 * page tests, so the header says what the thread has spent and how much of
 * it the cache served. New Thread drops the thread on screen; the next
 * question cuts a fresh fork, and the old one is never shown again.
 *
 * Asking and changing stay two explicit actions. Ask (↵) goes to the fork,
 * which only reads. Request change (⌘↵) goes to Nyte, which commits in a
 * worktree of its own; what it does after the thread began shows here too.
 */
import { create, props } from "@stylexjs/stylex";
import { useRef, type ReactElement } from "react";
import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { composerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { radius, target } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import { useAsk, useChange, useRepo, useSideThread } from "./api";
import { referenceLabel } from "./code";
import type { GuideWriting } from "./guide";
import { useReviewState } from "./review-state";
import type { ReviewDetail } from "./wire";

const NO_LIVE_TOOLS = new Map();

const PERCENT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

const DOLLARS = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 3,
});

export function SideChat({
  review,
  version,
  writing,
}: {
  readonly review: ReviewDetail;
  readonly version: number;
  readonly writing: GuideWriting;
}): ReactElement {
  const root = useRepo().data?.root;
  const local = useReviewState(review.id, review.files);
  const { draft, references, thread } = local;
  const turns = useSideThread(review, thread, version);
  const focused = useRef(local.focus);
  const ask = useAsk(review.id);
  const change = useChange(review.id);
  const head = review.revision.head;
  const brief = review.briefs.find((entry) => entry.head === head);
  const guided = brief?.status === "done" && brief.guide !== undefined;
  const forks = review.threads.filter((entry) => entry.thread === thread?.id);
  const answering = forks.some((fork) => fork.status === "running");
  const working = review.author?.status === "working";
  const written = draft.trim() !== "" || references.length > 0;
  const pending = ask.isPending || change.isPending;
  const error = ask.error ?? change.error;

  const spent = forks.reduce(
    (total, fork) => ({
      cached: total.cached + fork.usage.cached,
      fresh: total.fresh + fork.usage.fresh,
      cost: total.cost + fork.usage.cost,
    }),
    { cached: 0, fresh: 0, cost: 0 },
  );

  const clear = (): void => {
    local.setDraft("");
    local.setReferences([]);
  };

  const askReviewer = (): void => {
    if (!written || !guided || pending) return;

    ask.mutate(
      {
        head,
        thread: local.threadForQuestion().id,
        key: crypto.randomUUID(),
        text: draft.trim(),
        references: [...references],
      },
      { onSuccess: clear },
    );
  };

  const requestChange = (): void => {
    if (!written || review.blocked !== undefined || pending) return;

    local.threadForQuestion();
    change.mutate(
      { key: crypto.randomUUID(), text: draft.trim(), references: [...references] },
      { onSuccess: clear },
    );
  };

  return (
    <aside aria-label="Side chat" {...props(styles.panel)}>
      <header {...props(styles.header)}>
        <span {...props(styles.title)}>Side chat</span>
        <span {...props(styles.spend)}>
          {spent.cached + spent.fresh > 0
            ? `${PERCENT.format(spent.cached / (spent.cached + spent.fresh))} from the guide's cache · ${DOLLARS.format(spent.cost)}`
            : guided
              ? `Forks the guide for ${head.slice(0, 7)}`
              : undefined}
        </span>
        <Button
          iconOnly
          icon="new-chat"
          aria-label="New thread"
          disabled={thread === undefined}
          onClick={local.newThread}
        />
      </header>
      <div {...props(styles.scroller)}>
        <div {...props(styles.transcript)}>
          {!guided && (
            <div {...props(styles.empty)}>
              <p {...props(styles.emptyText)}>
                Side chats fork the guide, so a question starts from everything it already read.
              </p>
              {brief?.status === "running" || writing.requesting ? (
                <span {...props(styles.emptyStatus)}>
                  <Spinner /> Writing the guide
                </span>
              ) : (
                <Button variant="solid" tone="primary" onClick={writing.onWrite}>
                  Write Guide
                </Button>
              )}
            </div>
          )}
          {turns.map(({ turn, source, head: about }, index) => (
            <div key={`${source}:${turn.id}`} {...props(styles.turn)}>
              <p {...props(styles.voice)}>
                {source === "nyte" ? "Nyte" : "Reviewer"}
                {about !== undefined && about !== head && (
                  <span translate="no" {...props(styles.voiceSha)}>
                    {about.slice(0, 7)}
                  </span>
                )}
              </p>
              <TurnView
                turn={turn}
                liveTools={NO_LIVE_TOOLS}
                cwd={source === "nyte" ? review.author?.worktree : root}
                onOpenChanges={() => {}}
                running={index === turns.length - 1 && (source === "nyte" ? working : answering)}
              />
            </div>
          ))}
        </div>
      </div>
      <div role="status" {...props(styles.status)}>
        {(working || answering) && (
          <>
            <Spinner />
            {working ? "Nyte is working on the branch" : "Answering"}
          </>
        )}
      </div>
      <form
        {...props(composerStyles.dock, styles.dock)}
        onSubmit={(event) => {
          event.preventDefault();
          askReviewer();
        }}
      >
        <div {...props(composerStyles.frame, composerStyles.frameFollowUpExpanded, styles.frame)}>
          {references.length > 0 && (
            <ul aria-label="Attached code" {...props(styles.references)}>
              {references.map((reference, index) => (
                <li
                  key={`${reference.path}:${reference.side}:${reference.start}:${reference.end}`}
                  {...props(styles.reference)}
                >
                  <FileTypeIcon path={reference.path} />
                  <span {...props(styles.referenceLabel)}>{referenceLabel(reference)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${referenceLabel(reference)}`}
                    onClick={() =>
                      local.setReferences(references.filter((_, position) => position !== index))
                    }
                    {...props(styles.remove)}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={(node) => {
              // "Ask about this section" asks for focus by bumping the counter.
              if (node === null || focused.current === local.focus) return;

              focused.current = local.focus;
              node.focus();
              node.setSelectionRange(node.value.length, node.value.length);
            }}
            aria-label="Message"
            placeholder="Ask about this change, or ask Nyte to change it"
            rows={2}
            value={draft}
            onChange={(event) => local.setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

              event.preventDefault();

              if (event.metaKey || event.ctrlKey) requestChange();
              else askReviewer();
            }}
            {...props(composerStyles.input, styles.input)}
          />
          {error !== null && (
            <p role="alert" {...props(styles.error)}>
              {error.message}
            </p>
          )}
          <div {...props(styles.controls)}>
            <span {...props(styles.spacer)} />
            <Button
              type="submit"
              variant="outline"
              disabled={!written || !guided}
              disabledReason={guided ? undefined : "Write the guide first"}
              loading={ask.isPending}
              aria-keyshortcuts="Enter"
            >
              Ask <Kbd keys={["↵"]} plain />
            </Button>
            <Button
              type="button"
              variant="solid"
              tone="primary"
              disabled={!written || review.blocked !== undefined}
              disabledReason={review.blocked}
              loading={change.isPending}
              aria-keyshortcuts="Meta+Enter"
              onClick={requestChange}
            >
              Request change <Kbd keys={["⌘", "↵"]} plain />
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "min(420px, 42%)",
    minWidth: 320,
    minHeight: 0,
    flexShrink: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingBlock: 6,
    paddingInline: "16px 8px",
  },
  title: { color: role.contentPrimary, fontSize: type.fontSm, fontWeight: 600, flexShrink: 0 },
  spend: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
    paddingInline: conversation.gutter,
  },
  emptyText: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  emptyStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  dock: { flexShrink: 0 },
  // Reversed, so the newest message stays in view as turns arrive and nothing has to scroll it there.
  scroller: {
    display: "flex",
    flexDirection: "column-reverse",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  transcript: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.turnGap,
    paddingBlock: 16,
  },
  turn: { display: "flex", flexDirection: "column", gap: 6, paddingInline: conversation.gutter },
  voice: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    fontWeight: 500,
  },
  voiceSha: { fontFamily: type.fontMono, fontWeight: 400, fontVariantNumeric: "tabular-nums" },
  status: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: conversation.gutter,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    ":not(:empty)": { paddingBlock: 8 },
  },
  frame: { gap: 6, padding: "8px 8px 8px 12px" },
  references: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  reference: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    minHeight: target.min,
    paddingInline: "6px 2px",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
  },
  referenceLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  remove: {
    display: "inline-grid",
    placeItems: "center",
    width: target.min,
    height: target.min,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    color: role.contentInteractiveSecondary,
    cursor: appearance.cursorInteractive,
  },
  input: {
    minHeight: 40,
    resize: "none",
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
  },
  error: { margin: 0, color: role.contentSecondary, fontSize: type.fontSm, textWrap: "pretty" },
  controls: { display: "flex", alignItems: "center", gap: 8 },
  spacer: { flex: 1 },
});
