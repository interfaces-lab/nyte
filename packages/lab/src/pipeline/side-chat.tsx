import { intent } from "@nyte-ai/ui/surface-theme";
import { radius, target } from "@nyte-ai/ui/schema.stylex";
/**
 * The side chat is the PR's own Nyte session: the product transcript
 * (`TurnView`) and composer, with selected code attached as references. Its
 * header says which branch your checkout is on, because the agent may leave
 * it to edit the PR and must bring you back.
 */
import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { composerStyles, messageScrollerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import type { RenderedTurn } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnView } from "@nyte-ai/app/conversation/turn-view.tsx";
import { conversation } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
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
    <aside aria-label="Side chat" {...props(styles.pane)}>
      <div {...props(styles.head)}>
        <Icon name="agent" size={14} />
        <span {...props(styles.title)}>{title}</span>
        <span
          title={
            agentBranch === undefined
              ? `Your checkout is on ${checkout}`
              : `Nyte is on ${agentBranch} and will switch back to ${checkout}`
          }
          {...props(
            styles.branch,
            agentBranch !== undefined && [intent.warning, styles.branchAway],
          )}
        >
          <Icon name="git-branch" size={12} />
          <span {...props(styles.branchName)}>{agentBranch ?? checkout}</span>
        </span>
      </div>
      <div ref={scroller} {...props(messageScrollerStyles.viewport)}>
        <div {...props(styles.transcript)}>
          {turns.map((turn, index) => (
            <div key={turn.kind === "turn" ? turn.id : String(index)} {...props(styles.turn)}>
              <TurnView
                turn={turn}
                liveTools={NO_LIVE_TOOLS}
                cwd={workspace.path}
                onOpenChanges={() => {}}
                running={running && index === turns.length - 1}
              />
            </div>
          ))}
        </div>
      </div>
      <div {...props(composerStyles.dock)}>
        <div
          role="region"
          aria-label="Message Nyte"
          {...props(composerStyles.region, styles.region)}
        >
          <div {...props(composerStyles.frame, composerStyles.frameFollowUpExpanded, styles.frame)}>
            {references.length > 0 && (
              <div {...props(styles.references)}>
                {references.map((reference, index) => (
                  <span
                    key={`${reference.path}:${reference.start}:${reference.end}:${reference.side}`}
                    {...props(styles.reference)}
                  >
                    <FileTypeIcon path={reference.path} />
                    {referenceLabel(reference)}
                    <button
                      type="button"
                      aria-label={`Remove ${referenceLabel(reference)}`}
                      onClick={() => onRemoveReference(index)}
                      {...props(styles.remove)}
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
              {...props(composerStyles.input, styles.input)}
            />
            <div {...props(styles.controls)}>
              <span {...props(styles.spacer)} />
              <Button
                iconOnly
                icon="arrow-up"
                aria-label="Send"
                variant="solid"
                tone="primary"
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
    color: role.contentSecondary,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 72,
    overflow: "hidden",
    color: role.contentPrimary,
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
    height: type.leadingLg,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: 11,
  },
  branchName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  branchAway: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentSecondary,
  },
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
    minHeight: target.min,
    paddingInline: "6px 4px",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: 11.5,
  },
  remove: {
    display: "inline-grid",
    placeItems: "center",
    width: target.min,
    height: target.min,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
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
  controls: { display: "flex", alignItems: "center", gap: 8 },
  spacer: { flex: 1 },
});
