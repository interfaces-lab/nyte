/**
 * One task call: the subagent's title over its status, with the model beside
 * the title once the child session exists. The status comes from the chat's
 * jobs, since a backgrounded call settles while its subagent keeps working;
 * until the job is listed the tool's own state stands in. Same law as other
 * tool calls: no status icon, the shimmer is the running state.
 */
import * as stylex from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/core";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import type { ToolCallDensity } from "../theme/boot.ts";
import { useCatalog, useJobs, useSession } from "../queries.ts";
import { jobStateLabel } from "./jobs-view.ts";
import { modelDisplayName } from "./model-picker-state.ts";
import { activityStyles, subagentCallStyles, toolCallStyles } from "./styles.stylex.ts";
import { useSubagentInspector } from "./subagent-inspector.ts";
import type { SubagentCall, ToolPresentation } from "./tool-detail.ts";

const TOOL_STATE_LABEL = {
  running: "Working",
  done: "Completed",
  failed: "Failed",
} satisfies Readonly<Record<ToolPresentation["state"], string>>;

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
  const catalog = useCatalog();
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

export function SubagentCallView({
  call,
  presentation,
  density,
}: {
  call: SubagentCall;
  presentation: ToolPresentation;
  density: ToolCallDensity;
}): ReactElement {
  const inspector = useSubagentInspector();
  const jobs = useJobs(inspector?.sessionId);
  const job = jobs.data?.find(
    (candidate) =>
      candidate.kind === "subagent" && candidate.childSessionId === call.childSessionId,
  );
  const running = job === undefined ? presentation.state === "running" : job.state === "running";
  const failed = job === undefined ? presentation.state === "failed" : job.state === "failed";
  const status = job === undefined ? TOOL_STATE_LABEL[presentation.state] : jobStateLabel(job);
  const expandable = presentation.body.kind === "output";
  const { childSessionId } = call;
  const content = (open: boolean): ReactElement => (
    <>
      <span {...stylex.props(subagentCallStyles.head)}>
        <span {...stylex.props(toolCallStyles.verb)}>{call.title}</span>
        {childSessionId !== undefined && (
          <SubagentModel childSessionId={childSessionId} style={toolCallStyles.detail} />
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
        {inspector !== undefined && childSessionId !== undefined && (
          <button
            type="button"
            aria-label={`Open ${call.title} in the Agents panel`}
            title="Open in Agents panel"
            {...stylex.props(toolCallStyles.openAgent, focus.ring)}
            onClick={() => inspector.inspect(childSessionId)}
          >
            <Icon name="expand" size={12} />
          </button>
        )}
      </div>
      {presentation.body.kind === "output" && (
        <Collapsible.Panel
          role="region"
          aria-label={`${call.title} report`}
          data-nyte-scrollport
          {...stylex.props(toolCallStyles.output)}
        >
          {presentation.body.text}
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}
