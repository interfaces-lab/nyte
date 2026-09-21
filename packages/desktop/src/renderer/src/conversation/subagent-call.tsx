/**
 * One delegation. A `create` is the subagent's card from its first frame:
 * the title the call named over the child's status, with the model beside the
 * title once the child session is listed. The status comes from the chat's
 * child sessions, since a create settles while its subagent keeps working;
 * until the child is listed the card says nothing about it, except that a
 * failed create failed. Every other call on a child (`send`, `await`, `read`, `stop`) is one compact line
 * for the same child, never a second card; while the run is blocked
 * on it, the line's place is taken by the card's "Waiting" status. Same law as
 * other tool calls: no status icon, the shimmer is the running state.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { RunConfig, SessionId, ToolClass } from "@nyte-ai/protocol";
import { focus, Hint, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useCatalog } from "../queries.ts";
import { AGENT_STATE_LABEL, agentState } from "./agent-status.ts";
import { Countdown } from "./countdown.tsx";
import { modelDisplayName } from "./model-picker-state.ts";
import { activityStyles, subagentCallStyles, toolCallStyles } from "./styles.stylex.ts";
import { useChildSession, useOpenSubagentTray } from "./subagent-sessions.ts";
import { toolVerb } from "./tool-copy.ts";
import type { ToolPhase } from "./tool-copy.ts";

export type DelegateToolClass = Extract<ToolClass, { readonly kind: "delegate" }>;

const PHASE_STATUS = {
  running: "Working",
  done: "Completed",
  failed: "Failed",
  interrupted: "Stopped",
} satisfies Readonly<Record<ToolPhase, string>>;

/** The model a subagent runs on, in muted text; nothing until the child session is listed. */
function SubagentModel({
  session,
  model,
}: {
  session: SessionId;
  model: RunConfig["model"];
}): ReactElement | null {
  const catalog = useCatalog(session);
  const name = modelDisplayName(catalog.data, model);
  if (name === undefined) return null;
  return <span {...props(toolCallStyles.detail)}>{name}</span>;
}

export function SubagentCallView({
  session,
  title,
  phase,
  density,
  awaited,
}: {
  session: SessionId;
  title: string;
  phase: ToolPhase;
  density: ToolCallDensity;
  /** The run is blocked on this child. */
  awaited: boolean;
}): ReactElement {
  const child = useChildSession(session);
  const openTray = useOpenSubagentTray();
  const state = child === undefined ? undefined : agentState(child);
  const blocking = awaited && state !== "completed" && state !== "failed" && state !== "stopped";
  const failed = state === undefined ? phase === "failed" : state === "failed";
  const status = blocking
    ? "Waiting"
    : state === undefined
      ? phase === "failed"
        ? PHASE_STATUS.failed
        : undefined
      : AGENT_STATE_LABEL[state];
  const running = blocking || state === "working";
  const content = (
    <>
      <span {...props(subagentCallStyles.head)}>
        <span {...props(toolCallStyles.verb)}>{title}</span>
        {child !== undefined && <SubagentModel session={session} model={child.config.model} />}
      </span>
      {status !== undefined && (
        <span {...props(subagentCallStyles.status, running && activityStyles.shimmer)}>
          {status}
        </span>
      )}
    </>
  );
  const lineStyles = [
    toolCallStyles.line,
    subagentCallStyles.line,
    density === "detailed" && toolCallStyles.lineDetailed,
    density === "detailed" && subagentCallStyles.lineDetailed,
    failed && toolCallStyles.failed,
  ];

  return openTray === undefined ? (
    <div {...props(...lineStyles, toolCallStyles.lineStatic)}>{content}</div>
  ) : (
    <button
      type="button"
      aria-label={`Open ${title}`}
      {...props(...lineStyles, focus.ring)}
      onClick={() => openTray(session)}
    >
      {content}
    </button>
  );
}

/** A call on a child: the verb, then the child's name once the child is listed. */
export function SubagentLineView({
  toolClass,
  phase,
  density,
  until,
}: {
  toolClass: DelegateToolClass;
  phase: ToolPhase;
  density: ToolCallDensity;
  /** When the parked call wakes unanswered; counts down beside the name. */
  until: number | undefined;
}): ReactElement {
  const session =
    toolClass.target.kind === "one" ? toolClass.target.session : toolClass.target.sessions[0];
  const child = useChildSession(session)?.name;
  const openTray = useOpenSubagentTray();
  const others = toolClass.target.kind === "many" ? toolClass.target.sessions.length - 1 : 0;
  const label =
    child === undefined ? undefined : others > 0 ? `${child} +${String(others)}` : child;
  const content = (
    <>
      <span {...props(toolCallStyles.verb, phase === "running" && activityStyles.shimmer)}>
        {toolVerb(toolClass, phase)}
      </span>
      {phase !== "done" && <span {...props(srOnly)}>{PHASE_STATUS[phase]}</span>}
      {label !== undefined && (
        <Hint content={label} trigger={<span {...props(toolCallStyles.detail)}>{label}</span>} />
      )}
      {phase === "running" && until !== undefined && (
        <span {...props(toolCallStyles.detail)}>
          <Countdown until={until} />
        </span>
      )}
    </>
  );
  const lineStyles = [
    toolCallStyles.line,
    density === "detailed" && toolCallStyles.lineDetailed,
    phase === "failed" && toolCallStyles.failed,
  ];
  if (openTray === undefined) {
    return (
      <div data-tool-status={phase} {...props(...lineStyles, toolCallStyles.lineStatic)}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-tool-status={phase}
      {...props(...lineStyles, focus.ring)}
      onClick={() =>
        toolClass.target.kind === "many" && toolClass.target.sessions.length > 1
          ? openTray()
          : openTray(session)
      }
    >
      {content}
    </button>
  );
}
