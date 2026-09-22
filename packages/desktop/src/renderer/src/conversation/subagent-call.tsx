import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { RunConfig, SessionId, ToolClass } from "@nyte-ai/protocol";
import { focus, Hint } from "../components/ui.tsx";
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
}: {
  session: SessionId;
  title: string;
  phase: ToolPhase;
  density: ToolCallDensity;
}): ReactElement {
  const child = useChildSession(session);
  const openTray = useOpenSubagentTray();
  const state = child === undefined ? undefined : "kind" in child ? "starting" : agentState(child);
  const failed = state === undefined ? phase === "failed" : state === "failed";

  const status =
    state === "starting"
      ? "Starting"
      : state === undefined
        ? phase === "failed"
          ? "Failed"
          : undefined
        : AGENT_STATE_LABEL[state];

  const running = state === "starting" || state === "working";

  const content = (
    <>
      <span
        aria-hidden="true"
        {...props(subagentCallStyles.dot, failed && subagentCallStyles.failed)}
      />
      <span {...props(subagentCallStyles.head)}>
        <span {...props(subagentCallStyles.title)}>{title}</span>
        {child !== undefined && !("kind" in child) && (
          <SubagentModel session={session} model={child.config.model} />
        )}
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
    density === "detailed" && subagentCallStyles.lineDetailed,
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

  const childSession = useChildSession(session);

  const child =
    childSession === undefined
      ? undefined
      : "kind" in childSession
        ? childSession.title
        : childSession.name;

  const openTray = useOpenSubagentTray();
  const others = toolClass.target.kind === "many" ? toolClass.target.sessions.length - 1 : 0;

  const label =
    child === undefined ? undefined : others > 0 ? `${child} +${String(others)}` : child;

  const content = (
    <>
      <span {...props(toolCallStyles.verb, phase === "running" && activityStyles.shimmer)}>
        {toolVerb(toolClass, phase)}
      </span>
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

  const failed = phase === "failed" && toolCallStyles.failed;
  const lineStyles = [toolCallStyles.line, density === "detailed" && toolCallStyles.lineDetailed];

  if (openTray === undefined) {
    return (
      <div data-tool-status={phase} {...props(...lineStyles, toolCallStyles.lineStatic, failed)}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-tool-status={phase}
      {...props(...lineStyles, failed, focus.ring)}
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
