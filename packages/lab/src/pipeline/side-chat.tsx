/**
 * The side chat is the PR's own Nyte session: the product transcript
 * (`TurnView`) and composer, with selected code attached as references. Its
 * header says which branch your checkout is on, because the agent may leave
 * it to edit the PR and must bring you back.
 */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { composerStyles, messageScrollerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { NO_WAITS } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import type { RenderedTurn } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { t } from "@nyte-ai/ui/vars.stylex";
import { workspace } from "../shell/host-stub";
import { referenceLabel, type CodeReference } from "./code";

const NO_LIVE_TOOLS = new Map();

export function SideChat({
  title,
  turns,
  running,
  checkout,
  agentBranch,
  references,
  onRemoveReference,
  canSend,
  working,
  onSend,
}: {
  readonly title: string;
  readonly turns: readonly RenderedTurn[];
  readonly running: boolean;
  readonly checkout: string;
  readonly agentBranch: string | undefined;
  readonly references: readonly CodeReference[];
  readonly onRemoveReference: (index: number) => void;
  readonly canSend: boolean;
  readonly working: boolean;
  readonly onSend: (text: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const size = turns.reduce(
    (total, turn) => total + (turn.kind === "turn" ? turn.parts.length : 1),
    0,
  );
  const ready = canSend && (draft.trim() !== "" || references.length > 0);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [size]);

  const send = (): void => {
    if (!ready) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <aside aria-label="Side chat" {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.head)}>
        <Icon name="robot" size={14} />
        <span {...stylex.props(styles.title)}>{title}</span>
        <span
          title={
            agentBranch === undefined
              ? `Your checkout is on ${checkout}`
              : `Nyte is on ${agentBranch} and will switch back to ${checkout}`
          }
          {...stylex.props(styles.branch, agentBranch !== undefined && styles.branchAway)}
        >
          <Icon name="git-branch" size={12} />
          <span {...stylex.props(styles.branchName)}>{agentBranch ?? checkout}</span>
        </span>
      </div>
      <div ref={scroller} {...stylex.props(messageScrollerStyles.viewport)}>
        <div {...stylex.props(styles.transcript)}>
          {turns.map((turn, index) => (
            <div
              key={turn.kind === "turn" ? turn.id : String(index)}
              {...stylex.props(styles.turn)}
            >
              <TurnView
                turn={turn}
                liveTools={NO_LIVE_TOOLS}
                cwd={workspace.path}
                onOpenChanges={() => {}}
                running={running && index === turns.length - 1}
                waits={NO_WAITS}
              />
            </div>
          ))}
        </div>
      </div>
      <div {...stylex.props(composerStyles.dock)}>
        <div
          role="region"
          aria-label="Message Nyte"
          {...stylex.props(composerStyles.region, styles.region)}
        >
          <div
            {...stylex.props(
              composerStyles.frame,
              composerStyles.frameFollowUpExpanded,
              styles.frame,
            )}
          >
            {references.length > 0 && (
              <div {...stylex.props(styles.references)}>
                {references.map((reference, index) => (
                  <span
                    key={`${reference.path}:${reference.start}:${reference.end}:${reference.side}`}
                    {...stylex.props(styles.reference)}
                  >
                    <FileTypeIcon path={reference.path} />
                    {referenceLabel(reference)}
                    <button
                      type="button"
                      aria-label={`Remove ${referenceLabel(reference)}`}
                      onClick={() => onRemoveReference(index)}
                      {...stylex.props(styles.remove)}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              aria-label="Message Nyte"
              placeholder={working ? "Nyte is working" : "Ask Nyte to change this pull request"}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              {...stylex.props(composerStyles.input, styles.input)}
            />
            <div {...stylex.props(styles.controls)}>
              <span {...stylex.props(styles.spacer)} />
              <Button
                iconOnly
                icon="arrow-up"
                aria-label="Send"
                variant="inverse"
                round
                disabled={!ready}
                onClick={send}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

const styles = stylex.create({
  pane: {
    display: "flex",
    flexDirection: "column",
    width: 400,
    flexShrink: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.borderSecondaryTranslucent,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.borderSecondaryTranslucent,
    color: t.contentSecondary,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 72,
    overflow: "hidden",
    color: t.contentPrimary,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    maxWidth: "65%",
    paddingInline: 6,
    height: 20,
    borderRadius: t.radius4,
    backgroundColor: t.bgMutedTranslucent,
    color: t.contentSecondary,
    fontFamily: t.fontMono,
    fontSize: 11,
  },
  branchName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  branchAway: { backgroundColor: t.intentWarningBg, color: t.intentWarningContent },
  transcript: { display: "flex", flexDirection: "column", paddingBlock: 16 },
  turn: {
    paddingInline: conversation.gutter,
    paddingTop: { default: conversation.turnGap, ":first-child": 0 },
  },
  region: { width: "100%" },
  frame: { gap: 6, padding: "8px 8px 8px 12px" },
  references: { display: "flex", flexWrap: "wrap", gap: 6 },
  reference: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    paddingInline: "6px 4px",
    borderRadius: t.radius6,
    backgroundColor: t.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
    color: t.contentSecondary,
    fontFamily: t.fontMono,
    fontSize: 11.5,
  },
  remove: {
    display: "inline-grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderStyle: "none",
    borderRadius: t.radius4,
    backgroundColor: { default: "transparent", ":hover": t.bgHover },
    color: t.contentInteractiveSecondary,
    cursor: t.cursorInteractive,
  },
  input: {
    minHeight: 40,
    resize: "none",
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: t.contentPrimary,
    font: "inherit",
  },
  controls: { display: "flex", alignItems: "center", gap: 8 },
  spacer: { flex: 1 },
});
