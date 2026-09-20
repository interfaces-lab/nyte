/**
 * One delegation. A `create` is the subagent's card from its first frame:
 * the child's name over its status, with the model beside the name once the
 * child session is listed. The status comes from the chat's child sessions,
 * since a create settles while its subagent keeps working; until the child is
 * listed the tool's own phase stands in and the session id is the name. Every
 * other call on a child (`send`, `await`, `read`, `stop`) is one compact line
 * that links to the same child, never a second card; while the run is blocked
 * on it, the line's place is taken by the card's "Waiting" status. Same law as
 * other tool calls: no status icon, the shimmer is the running state.
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import type { ReactElement } from "react";
import type { RunConfig, SessionId, ToolClass } from "@nyte-ai/protocol";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useCatalog } from "../queries.ts";
import { AGENT_STATE_LABEL, agentState } from "./agent-status.ts";
import { Countdown } from "./countdown.tsx";
import { modelDisplayName } from "./model-picker-state.ts";
import { activityStyles, subagentCallStyles, toolCallStyles } from "./styles.stylex.ts";
import { useSubagentInspector } from "./subagent-inspector.ts";
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
  return <span {...stylex.props(toolCallStyles.detail)}>{name}</span>;
}

function useChild(session: SessionId) {
  return useSubagentInspector()?.children.get(session);
}

function OpenAgentButton({
  title,
  session,
}: {
  title: string;
  session: SessionId;
}): ReactElement | null {
  const inspector = useSubagentInspector();
  if (inspector === undefined) return null;
  return (
    <button
      type="button"
      aria-label={`Open ${title} in the Agents panel`}
      title="Open in Agents panel"
      {...stylex.props(toolCallStyles.openAgent, focus.ring)}
      onClick={() => inspector.inspect(session)}
    >
      <Icon name="expand" size={12} />
    </button>
  );
}

export function SubagentCallView({
  session,
  phase,
  output,
  density,
  awaited,
}: {
  session: SessionId;
  phase: ToolPhase;
  output: string | undefined;
  density: ToolCallDensity;
  /** The run is blocked on this child. */
  awaited: boolean;
}): ReactElement {
  const child = useChild(session);
  const title = child?.name ?? session;
  const state = child === undefined ? undefined : agentState(child);
  const blocking = awaited && state !== "completed" && state !== "failed" && state !== "stopped";
  const running = blocking || (state === undefined ? phase === "running" : state === "working");
  const failed = state === undefined ? phase === "failed" : state === "failed";
  const status = blocking
    ? "Waiting"
    : state === undefined
      ? PHASE_STATUS[phase]
      : AGENT_STATE_LABEL[state];
  const expandable = output !== undefined;
  const content = (open: boolean): ReactElement => (
    <>
      <span {...stylex.props(subagentCallStyles.head)}>
        <span {...stylex.props(toolCallStyles.verb)}>{title}</span>
        {child !== undefined && <SubagentModel session={session} model={child.config.model} />}
        {expandable && (
          <span {...stylex.props(toolCallStyles.chevron, open && toolCallStyles.chevronOpen)}>
            <Icon name="chevron-right" size={12} />
          </span>
        )}
      </span>
      <span {...stylex.props(subagentCallStyles.status, running && activityStyles.shimmer)}>
        {status}
      </span>
    </>
  );
  const lineStyles = [
    toolCallStyles.line,
    subagentCallStyles.line,
    density === "detailed" && toolCallStyles.lineDetailed,
    density === "detailed" && subagentCallStyles.lineDetailed,
    failed && toolCallStyles.failed,
  ];
  const line = expandable ? (
    <Collapsible.Trigger
      {...stylex.props(...lineStyles, focus.ring)}
      render={(props, state) => <button {...props}>{content(state.open)}</button>}
    />
  ) : (
    <div {...stylex.props(...lineStyles, toolCallStyles.lineStatic)}>{content(false)}</div>
  );

  return (
    <Collapsible.Root disabled={!expandable} {...stylex.props(toolCallStyles.root)}>
      <div {...stylex.props(toolCallStyles.row)}>
        {line}
        <OpenAgentButton title={title} session={session} />
      </div>
      {output !== undefined && (
        <Collapsible.Panel
          role="region"
          aria-label={`${title} report`}
          data-nyte-scrollport
          {...stylex.props(toolCallStyles.output)}
        >
          {output}
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}

/** A call on a child: the verb, then the child's name, or its id until the child is listed. */
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
  const child = useChild(session)?.name ?? session;
  const label =
    toolClass.target.kind === "many" && toolClass.target.sessions.length > 1
      ? `${child} +${String(toolClass.target.sessions.length - 1)}`
      : child;
  return (
    <div {...stylex.props(toolCallStyles.row)}>
      <div
        data-tool-status={phase}
        {...stylex.props(
          toolCallStyles.line,
          density === "detailed" && toolCallStyles.lineDetailed,
          toolCallStyles.lineStatic,
          phase === "failed" && toolCallStyles.failed,
        )}
      >
        <span {...stylex.props(toolCallStyles.verb, phase === "running" && activityStyles.shimmer)}>
          {toolVerb(toolClass, phase)}
        </span>
        {phase !== "done" && <span {...stylex.props(srOnly)}>{PHASE_STATUS[phase]}</span>}
        <span title={label} {...stylex.props(toolCallStyles.detail)}>
          {label}
        </span>
        {phase === "running" && until !== undefined && (
          <span {...stylex.props(toolCallStyles.detail)}>
            <Countdown until={until} />
          </span>
        )}
      </div>
      <OpenAgentButton title={label} session={session} />
    </div>
  );
}
