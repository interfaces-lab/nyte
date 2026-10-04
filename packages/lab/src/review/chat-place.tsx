/**
 * The side chat: one conversation about the branch. Nyte's work on it (the
 * task, each change you asked for, what it ran and committed) and the
 * reviewer's answers sit in the order they happened.
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
import type { ReactElement, RefObject } from "react";
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
import { useAsk, useChange, type ChatTurn } from "./api";
import { referenceLabel, type CodeReference } from "./code";
import type { ReviewDetail } from "./wire";

const NO_LIVE_TOOLS = new Map();

export function SideChat({
  review,
  root,
  turns,
  draft,
  onDraft,
  references,
  onReferences,
  composer,
}: {
  readonly review: ReviewDetail;
  /** The repository the reviewer reads, for shortening paths in its answers. */
  readonly root: string;
  readonly turns: readonly ChatTurn[];
  readonly draft: string;
  readonly onDraft: (draft: string) => void;
  readonly references: readonly CodeReference[];
  readonly onReferences: (references: readonly CodeReference[]) => void;
  readonly composer: RefObject<HTMLTextAreaElement | null>;
}): ReactElement {
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

  const clear = (): void => {
    onDraft("");
    onReferences([]);
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
    <aside aria-label="Side chat" {...props(styles.pane)}>
      <header {...props(styles.head)}>
        <Icon name="agent" size={14} xstyle={styles.headIcon} />
        <h2 title={review.title} {...props(styles.title)}>
          {review.title}
        </h2>
        <span
          title={
            review.author === undefined
              ? review.headRef
              : `Nyte works on ${review.headRef} in ${review.author.worktree}`
          }
          {...props(styles.branch)}
        >
          <Icon name="git-branch" size={12} />
          <span translate="no" {...props(styles.branchName)}>
            {review.headRef}
          </span>
        </span>
      </header>
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
        {...props(composerStyles.dock)}
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
                      onReferences(references.filter((_, position) => position !== index))
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
            ref={composer}
            aria-label="Message"
            placeholder="Ask about this change, or ask Nyte to change it"
            rows={2}
            value={draft}
            onChange={(event) => onDraft(event.currentTarget.value)}
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
    </aside>
  );
}

const styles = create({
  pane: {
    display: "flex",
    flexDirection: "column",
    width: 400,
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    flexShrink: 0,
  },
  headIcon: { color: role.contentSecondary },
  title: {
    flex: 1,
    minWidth: 72,
    margin: 0,
    overflow: "hidden",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    maxWidth: "55%",
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
  },
  branchName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
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
