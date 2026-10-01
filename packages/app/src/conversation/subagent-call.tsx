import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useCallback } from "react";
import type { ReactElement } from "react";
import type { SessionId, SessionInfo, ToolClass } from "@nyte-ai/protocol";
import { TextRoll } from "../components/text-roll.tsx";
import { UnreadMark } from "../components/ui.tsx";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Row } from "@nyte-ai/ui/row";
import { useSessionFrameSelector } from "../live.ts";
import type { SessionFrame } from "../live.ts";
import { useCatalog, useChildSessions, useSession } from "../queries.ts";
import { sessionHasUnreadCompletion, useReadSessions } from "../session-read-state.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import { Countdown } from "./countdown.tsx";
import { modelDisplayName } from "./model-picker-state.ts";
import { activityStyles, subagentCallStyles, toolCallStyles } from "./styles.stylex.ts";
import { useChildSession, useOpenSubagentTray } from "./subagent-sessions.ts";
import { callStatus, sessionStatus, subagentActivity } from "./subagent-status.ts";
import type { SubagentStatus } from "./subagent-status.ts";
import { toolVerb } from "./tool-copy.ts";
import type { ToolPhase } from "./tool-copy.ts";

export type DelegateToolClass = Extract<ToolClass, { readonly kind: "delegate" }>;

/** A listed child speaks for itself; until then its create call does. */
type SubagentSubject =
  | { readonly kind: "session"; readonly session: SessionInfo }
  | { readonly kind: "call"; readonly status: SubagentStatus };

function SubagentModel({ session }: { readonly session: SessionInfo }): ReactElement | null {
  const catalog = useCatalog(session.sessionId);
  const name = modelDisplayName(catalog.data, session.config.model);

  if (name === undefined) return null;

  return <span {...props(subagentCallStyles.model)}>{name}</span>;
}

/** The status line; while the child runs, its current step replaces the status. */
function SubagentStatusLine({
  status,
  watched,
  cwd,
}: {
  readonly status: SubagentStatus;
  readonly watched: SessionId | undefined;
  readonly cwd: string | undefined;
}): ReactElement {
  const select = useCallback(
    (frame: SessionFrame | undefined) => subagentActivity(frame, cwd),
    [cwd],
  );

  const activity = useSessionFrameSelector(watched, select);
  const running = status.indicator === "running";

  return (
    <span
      {...props(
        subagentCallStyles.status,
        status.indicator === "attention" && intent.warning,
        status.indicator === "attention" && subagentCallStyles.statusAttention,
      )}
    >
      <TextRoll
        text={activity ?? status.text}
        itemStyle={running ? activityStyles.shimmer : undefined}
      />
    </span>
  );
}

/** Indicator, title, model, and status; the whole row opens the child in the tray. */
function SubagentRow({
  title,
  subject,
  cwd,
  open,
  xstyle,
}: {
  readonly title: string;
  readonly subject: SubagentSubject;
  readonly cwd: string | undefined;
  readonly open: (() => void) | undefined;
  readonly xstyle: StyleXStyles;
}): ReactElement {
  const read = useReadSessions();

  const status =
    subject.kind === "session"
      ? sessionStatus(subject.session, sessionHasUnreadCompletion(subject.session, read))
      : subject.status;

  const content = (
    <>
      <span aria-hidden="true" {...props(subagentCallStyles.indicator)}>
        {status.indicator === "running" ? (
          <Spinner />
        ) : status.indicator === "unread" ? (
          <UnreadMark />
        ) : (
          <span
            {...props(
              status.indicator === "attention" && surfaceTheme.yellow,
              status.indicator === "failed" && surfaceTheme.red,
              subagentCallStyles.dot,
              subagentCallStyles[status.indicator],
            )}
          />
        )}
      </span>
      <span {...props(subagentCallStyles.text)}>
        <span {...props(subagentCallStyles.titleRow)}>
          <span {...props(subagentCallStyles.title)}>{title}</span>
          {subject.kind === "session" && <SubagentModel session={subject.session} />}
        </span>
        {status.text !== "" && (
          <SubagentStatusLine
            status={status}
            watched={
              subject.kind === "session" && status.indicator === "running"
                ? subject.session.sessionId
                : undefined
            }
            cwd={cwd}
          />
        )}
      </span>
    </>
  );

  if (open === undefined) return <div {...props(subagentCallStyles.row, xstyle)}>{content}</div>;

  return (
    <Row.Primary onClick={open} xstyle={[subagentCallStyles.row, xstyle, focus.ring]}>
      {content}
    </Row.Primary>
  );
}

/** A coordinator's own children, one compact row each. */
function SubagentNestedRows({
  session,
  cwd,
}: {
  readonly session: SessionId;
  readonly cwd: string | undefined;
}): ReactElement | null {
  const children = useChildSessions(session);
  const openTray = useOpenSubagentTray();

  if (children.data === undefined || children.data.length === 0) return null;

  return (
    <div {...props(subagentCallStyles.nested)}>
      {children.data
        .toSorted((left, right) => left.createdAt - right.createdAt)
        .map((child) => (
          <SubagentRow
            key={child.sessionId}
            title={child.name ?? child.preview ?? "Subagent"}
            subject={{ kind: "session", session: child }}
            cwd={cwd}
            open={openTray === undefined ? undefined : () => openTray(child.sessionId)}
            xstyle={subagentCallStyles.nestedRow}
          />
        ))}
    </div>
  );
}

export function SubagentCallView({
  session,
  title,
  phase,
  density,
  cwd,
}: {
  readonly session: SessionId;
  readonly title: string;
  readonly phase: ToolPhase;
  readonly density: ToolCallDensity;
  readonly cwd: string | undefined;
}): ReactElement {
  // The parent's list lags the child, and a parent that stopped or was left
  // behind lists no provisional one. The call's phase is the parent's, not the
  // child's: it speaks only once the child is known never to have started.
  const listed = useChildSession(session);
  const read = useSession(session);
  const child = listed ?? read.data ?? undefined;
  const openTray = useOpenSubagentTray();

  const subject: SubagentSubject =
    child === undefined
      ? { kind: "call", status: callStatus(read.data === null ? phase : "running") }
      : "kind" in child
        ? { kind: "call", status: callStatus("running") }
        : { kind: "session", session: child };

  return (
    <div {...props(subagentCallStyles.root)}>
      <SubagentRow
        title={title}
        subject={subject}
        cwd={cwd}
        open={openTray === undefined ? undefined : () => openTray(session)}
        xstyle={
          density === "detailed" ? subagentCallStyles.headerDetailed : subagentCallStyles.header
        }
      />
      {subject.kind === "session" && <SubagentNestedRows session={session} cwd={cwd} />}
    </div>
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
        <Tooltip>
          <TooltipTrigger render={<span {...props(toolCallStyles.detail)}>{label}</span>} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      {phase === "running" && until !== undefined && (
        <span {...props(toolCallStyles.detail)}>
          <Countdown until={until} />
        </span>
      )}
    </>
  );

  const failed = phase === "failed" && [intent.danger, toolCallStyles.failed];
  const lineStyles = [toolCallStyles.line, density === "detailed" && toolCallStyles.lineDetailed];

  if (openTray === undefined) {
    return (
      <div data-tool-status={phase} {...props(...lineStyles, toolCallStyles.lineStatic, failed)}>
        {content}
      </div>
    );
  }

  return (
    <Row.Primary
      data-tool-status={phase}
      xstyle={[lineStyles, failed, focus.ring]}
      onClick={() =>
        toolClass.target.kind === "many" && toolClass.target.sessions.length > 1
          ? openTray()
          : openTray(session)
      }
    >
      {content}
    </Row.Primary>
  );
}
