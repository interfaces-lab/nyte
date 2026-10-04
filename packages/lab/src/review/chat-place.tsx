/**
 * A pull request's chat: one conversation about the branch, a place you open
 * in a pane and split beside its review. Nyte's work on it (the task, each
 * change you asked for, what it ran and committed) and the reviewer's
 * answers sit in the order they happened. The card at the top opens the
 * review: in place, in a background tab with ⌘, or beside.
 *
 * Asking and changing are two explicit actions, never guessed from the text.
 * Ask (↵) goes to the reviewer, a fork of the head's brief that only reads.
 * Request change (⌘↵) goes to Nyte, which edits and commits in a worktree of
 * its own, so your checkout never moves.
 *
 * Empty, it is only the composer, and the placeholder says what it does.
 * Code selected in the Guide or Changes rides along as chips.
 */
import { create, props } from "@stylexjs/stylex";
import { useRef, type MouseEvent, type ReactElement } from "react";
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
import { useAsk, useChange, useLiveReview, useRepo, useSideChat } from "./api";
import { referenceLabel } from "./code";
import { pullRequestNumber } from "./pull-request";
import { useReviewState } from "./review-state";
import type { OpenTarget, Place } from "./window";
import type { ReviewDetail } from "./wire";

const NO_LIVE_TOOLS = new Map();

/** How a click asks to open a place: ⌘ or a middle click for a background tab. */
export function targetOf(event: MouseEvent): OpenTarget {
  return event.metaKey || event.ctrlKey || event.button === 1 ? "background" : "here";
}

export function ChatPlace({
  reviewId,
  onOpen,
}: {
  readonly reviewId: string;
  readonly onOpen: (place: Place, target: OpenTarget) => void;
}): ReactElement {
  const { review, version } = useLiveReview(reviewId);

  if (review.data === undefined)
    return (
      <p role="status" {...props(styles.note)}>
        {review.error === null ? (
          <>
            <Spinner /> Opening the chat
          </>
        ) : (
          review.error.message
        )}
      </p>
    );

  return <Chat review={review.data} version={version} onOpen={onOpen} />;
}

function Chat({
  review,
  version,
  onOpen,
}: {
  readonly review: ReviewDetail;
  readonly version: number;
  readonly onOpen: (place: Place, target: OpenTarget) => void;
}): ReactElement {
  const root = useRepo().data?.root;
  const turns = useSideChat(review, version);
  const local = useReviewState(review.id, []);
  const { draft, references } = local;
  const focused = useRef(local.focus);
  const ask = useAsk(review.id);
  const change = useChange(review.id);
  const head = review.revision.head;
  const brief = review.briefs.find((entry) => entry.head === head);
  const guided = brief?.status === "done" && brief.guide !== undefined;
  const answering = review.chats.some((chat) => chat.head === head && chat.status === "running");
  const working = review.author?.status === "working";
  const written = draft.trim() !== "" || references.length > 0;
  const pending = ask.isPending || change.isPending;
  const error = ask.error ?? change.error;
  const reviewPlace: Place = { kind: "review", reviewId: review.id };

  const clear = (): void => {
    local.setDraft("");
    local.setReferences([]);
  };

  const askReviewer = (): void => {
    if (!written || !guided || pending) return;

    ask.mutate(
      { head, key: crypto.randomUUID(), text: draft.trim(), references: [...references] },
      { onSuccess: clear },
    );
  };

  const requestChange = (): void => {
    if (!written || review.blocked !== undefined || pending) return;

    change.mutate(
      { key: crypto.randomUUID(), text: draft.trim(), references: [...references] },
      { onSuccess: clear },
    );
  };

  return (
    <section aria-label={`Chat: ${review.title}`} {...props(styles.pane)}>
      <div {...props(styles.card)}>
        <a
          href={`/review?id=${encodeURIComponent(review.id)}`}
          onClick={(event) => {
            event.preventDefault();
            onOpen(reviewPlace, targetOf(event));
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;

            event.preventDefault();
            onOpen(reviewPlace, "background");
          }}
          {...props(styles.cardLink)}
        >
          <Icon name="pull-request" size={14} xstyle={styles.cardIcon} />
          <span {...props(styles.cardBody)}>
            <span {...props(styles.cardTitle)}>
              {review.title}{" "}
              <span {...props(styles.cardNumber)}>#{pullRequestNumber(review.id)}</span>
            </span>
            <span
              translate="no"
              title={
                review.author === undefined
                  ? undefined
                  : `Nyte works on ${review.headRef} in ${review.author.worktree}`
              }
              {...props(styles.cardMeta)}
            >
              {review.headRef} → {review.baseRef}
            </span>
          </span>
        </a>
        <Button
          iconOnly
          icon="split-right"
          aria-label="Open review beside"
          onClick={() => onOpen(reviewPlace, "beside")}
        />
      </div>
      <div {...props(styles.scroller)}>
        <div {...props(styles.transcript)}>
          {turns.map(({ turn, source, head: about }, index) => (
            <div key={`${source}:${turn.id}`} {...props(styles.turn)}>
              {source === "reviewer" && (
                <p {...props(styles.voice)}>
                  Reviewer
                  {about !== undefined && (
                    <span translate="no" {...props(styles.voiceSha)}>
                      {about.slice(0, 7)}
                    </span>
                  )}
                </p>
              )}
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
            {working ? "Nyte is working on the branch" : "Reviewer is answering"}
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
              // "Ask about this section" in the review asks for focus by bumping the counter.
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
              disabledReason={guided ? undefined : "Ask once the guide is written"}
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
    </section>
  );
}

const styles = create({
  pane: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: 28,
    color: role.contentSecondary,
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginInline: conversation.gutter,
    marginBlockStart: 12,
    paddingInlineEnd: 4,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    flexShrink: 0,
  },
  cardLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
    paddingBlock: 8,
    paddingInlineStart: 12,
    borderRadius: radius.card,
    color: role.contentPrimary,
    textDecoration: "none",
  },
  cardIcon: { color: role.contentSecondary, flexShrink: 0 },
  cardNumber: { color: role.contentSecondary, fontWeight: 400 },
  cardBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  cardTitle: {
    overflow: "hidden",
    fontSize: type.fontSm,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    overflow: "hidden",
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
