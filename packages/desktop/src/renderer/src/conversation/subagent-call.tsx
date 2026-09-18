/**
 * One delegation. A spawn is the subagent's card: its title over its status,
 * with the model beside the title once the child session exists. The status
 * comes from the chat's jobs, since a backgrounded call settles while its
 * subagent keeps working; until the job is listed the tool's own phase stands
 * in. An await of that job is one compact line that links to the same child,
 * never a second card. Same law as other tool calls: no status icon, the
 * shimmer is the running state.
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { Icon } from "../components/icons.tsx";
import { focus, srOnly } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useCatalog, useJobs, useSession } from "../queries.ts";
import { jobStateLabel } from "./jobs-view.ts";
import type { SubagentJob } from "./jobs-view.ts";
import { modelDisplayName } from "./model-picker-state.ts";
import { activityStyles, subagentCallStyles, toolCallStyles } from "./styles.stylex.ts";
import { useSubagentInspector } from "./subagent-inspector.ts";
import { toolVerb } from "./tool-copy.ts";
import type { ToolPhase } from "./tool-copy.ts";

const PHASE_STATUS = {
  running: "Working",
  done: "Completed",
  failed: "Failed",
  interrupted: "Stopped",
} satisfies Readonly<Record<ToolPhase, string>>;

/** The model a subagent runs on, in muted text; nothing until the child session answers. */
export function SubagentModel({
  childSessionId,
  style,
  separator = "",
}: {
  childSessionId: SessionId;
  style?: stylex.StyleXStyles;
  /** Text after the name, so a caller can join it to what follows. */
  separator?: string;
}): ReactElement | null {
  const catalog = useCatalog(childSessionId);
  const child = useSession(childSessionId);
  const model = modelDisplayName(catalog.data, child.data?.config.model);
  if (model === undefined) return null;
  return (
    <span {...stylex.props(style)}>
      {model}
      {separator}
    </span>
  );
}

function OpenAgentButton({
  title,
  childSessionId,
}: {
  title: string;
  childSessionId: SessionId | undefined;
}): ReactElement | null {
  const inspector = useSubagentInspector();
  if (inspector === undefined || childSessionId === undefined) return null;
  return (
    <button
      type="button"
      aria-label={`Open ${title} in the Agents panel`}
      title="Open in Agents panel"
      {...stylex.props(toolCallStyles.openAgent, focus.ring)}
      onClick={() => inspector.inspect(childSessionId)}
    >
      <Icon name="expand" size={12} />
    </button>
  );
}

export function SubagentCallView({
  title,
  child,
  phase,
  output,
  density,
}: {
  title: string;
  child: SessionId | undefined;
  phase: ToolPhase;
  output: string | undefined;
  density: ToolCallDensity;
}): ReactElement {
  const inspector = useSubagentInspector();
  const jobs = useJobs(inspector?.sessionId);
  const job = jobs.data?.find(
    (candidate): candidate is SubagentJob =>
      candidate.kind === "subagent" && child !== undefined && candidate.childSessionId === child,
  );
  const running = job === undefined ? phase === "running" : job.state === "running";
  const failed = job === undefined ? phase === "failed" : job.state === "failed";
  const status = job === undefined ? PHASE_STATUS[phase] : jobStateLabel(job);
  const expandable = output !== undefined;
  const content = (open: boolean): ReactElement => (
    <>
      <span {...stylex.props(subagentCallStyles.head)}>
        <span {...stylex.props(toolCallStyles.verb)}>{title}</span>
        {child !== undefined && (
          <SubagentModel childSessionId={child} style={toolCallStyles.detail} />
        )}
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
        <OpenAgentButton title={title} childSessionId={child} />
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

/** The job names the subagent; until it is listed the line names the job id. */
export function SubagentAwaitView({
  jobId,
  phase,
  density,
}: {
  jobId: string;
  phase: ToolPhase;
  density: ToolCallDensity;
}): ReactElement {
  const inspector = useSubagentInspector();
  const jobs = useJobs(inspector?.sessionId);
  const job = jobs.data?.find(
    (candidate): candidate is SubagentJob =>
      candidate.kind === "subagent" && candidate.id === jobId,
  );
  const title = job?.title ?? jobId;
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
          {toolVerb({ kind: "delegate", role: "await", jobId }, phase)}
        </span>
        {phase !== "done" && <span {...stylex.props(srOnly)}>{PHASE_STATUS[phase]}</span>}
        <span title={title} {...stylex.props(toolCallStyles.detail)}>
          {title}
        </span>
      </div>
      <OpenAgentButton title={title} childSessionId={job?.childSessionId} />
    </div>
  );
}
