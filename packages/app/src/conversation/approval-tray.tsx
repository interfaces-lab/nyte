import { create, props } from "@stylexjs/stylex";
import { useId } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { APPROVAL_ACTIONS, approvalPrompt } from "@nyte-ai/plugin/approvals/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { tray } from "../theme/schema.stylex.ts";
import { Tray, trayParts, useTrayRoot } from "./tray/tray.tsx";
import { useAnswerApproval, useApprovalRequest } from "./approval-state.ts";
import type { ApprovalRequest } from "./approval-state.ts";

const styles = create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingBlock: space.s3,
    paddingInline: tray.paddingInline,
  },
  title: { margin: 0, color: role.contentPrimary, fontWeight: type.weightMedium },
  origin: { margin: 0, color: role.contentSecondary },
  detail: {
    margin: 0,
    maxHeight: 160,
    overflow: "auto",
    paddingBlock: space.s1_5,
    paddingInline: space.s2,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  status: { margin: 0, color: role.contentSecondary },
});

const NEXT = new Set(["ArrowRight", "ArrowDown"]);

const PREVIOUS = new Set(["ArrowLeft", "ArrowUp"]);

/** Arrow keys move between the answers, from the card onto the first or the last, and Escape denies, as in the terminal's approval list. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;

  if (step === 0) return;
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const current = buttons.findIndex((button) => button === document.activeElement);
  const next =
    current === -1 ? buttons.at(step > 0 ? 0 : -1) : buttons.at((current + step) % buttons.length);

  if (next === undefined) return;
  event.preventDefault();
  next.focus();
}

/** Takes the keyboard when a card arrives, on the card itself rather than an answer, so an Enter meant for the composer cannot allow the call. */
function takeFocus(card: HTMLDivElement | null): void {
  card?.focus();
}

function ApprovalCard({
  request,
  disabled,
}: {
  readonly request: ApprovalRequest;
  readonly disabled: boolean;
}): ReactElement {
  const id = useId();
  const answer = useAnswerApproval();
  const prompt = approvalPrompt(request.approval);
  const blocked = disabled || answer.isPending || answer.isSuccess;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          moveFocus(event);

          return;
        }

        if (event.defaultPrevented || blocked) return;
        event.preventDefault();
        event.stopPropagation();
        answer.mutate({ request, decision: "deny" });
      }}
      role="group"
      tabIndex={-1}
      ref={takeFocus}
      aria-labelledby={`${id}-title`}
      aria-describedby={prompt.detail === "" ? undefined : `${id}-detail`}
      data-part="ask/approval"
      {...props(styles.card, focus.ringInset)}
    >
      <h2 id={`${id}-title`} {...props(text.base, styles.title)}>
        {prompt.title}
      </h2>
      {request.origin !== undefined && (
        <p {...props(text.sm, styles.origin)}>Asked by {request.origin}</p>
      )}
      {prompt.detail !== "" && (
        <pre id={`${id}-detail`} {...props(text.code, styles.detail)}>
          {prompt.detail}
        </pre>
      )}
      <div {...props(styles.actions)}>
        {APPROVAL_ACTIONS.map(({ action, label }, index) => (
          <Button
            key={action}
            size="sm"
            variant={index === 0 ? "solid" : "outline"}
            aria-keyshortcuts={action === "deny" ? "Escape" : undefined}
            disabled={blocked}
            onClick={() => answer.mutate({ request, decision: action })}
          >
            {label}
          </Button>
        ))}
      </div>
      {answer.isPending && (
        <p role="status" {...props(text.sm, styles.status)}>
          Sending your answer…
        </p>
      )}
      {answer.isError && (
        <p role="alert" {...props(text.sm, styles.status)}>
          {answer.error.message}
        </p>
      )}
    </div>
  );
}

/** The tray above the composer that asks before a tool call runs, for this chat and its subagents. */
export function ApprovalTray({
  sessionId,
  disabled,
  viewport,
}: {
  readonly sessionId: SessionId;
  readonly disabled: boolean;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const request = useApprovalRequest(sessionId);
  const { ref } = useTrayRoot(viewport);

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={request !== undefined} label="Approval">
        {request !== undefined && (
          <ApprovalCard
            key={`${request.sessionId}:${request.approval.part}`}
            request={request}
            disabled={disabled}
          />
        )}
      </Tray>
    </div>
  );
}
