import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useCallback } from "react";
import type { ReactElement } from "react";
import { toolStatus } from "@nyte-ai/client";
import type { SessionId, SessionInfo, ToolState, TurnToolClass } from "@nyte-ai/protocol";
import { TextRoll } from "../components/text-roll.tsx";
import { UnreadMark } from "../components/ui.tsx";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Row } from "@nyte-ai/ui/row";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/vars.stylex";
import { useSessionFrameSelector } from "../live.ts";
import type { SessionFrame } from "../live.ts";
import { useCatalog, useChildSessions, useSession } from "../queries.ts";
import { sessionHasUnreadCompletion, useReadSessions } from "../session-read-state.ts";
import { modelDisplayName, providerIcon, THINKING_LABELS } from "./model-picker-state.ts";
import { activityStyles, proseStyles, subagentCallStyles } from "./styles.stylex.ts";
import { useChildSession, useOpenSubagentTray } from "./subagent-sessions.ts";
import {
  callStatus,
  DELEGATE_NOUNS,
  DELEGATE_VERBS,
  sessionStatus,
  subagentActivity,
} from "./subagent-status.ts";
import type { SubagentStatus } from "./subagent-status.ts";
import { ToolOutcome, toolLineStyles } from "./tool-line.tsx";

export type DelegateToolClass = Extract<TurnToolClass, { readonly kind: "delegate" }>;

const lineStyles = create({
  detailsRow: { display: "flex", alignItems: "center", gap: 4 },
  agent: {
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  agentButton: {
    display: "inline-block",
    flex: "0 1 auto",
    alignSelf: "auto",
    borderRadius: radius.indicator,
    textDecorationLine: "underline",
    textDecorationColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "currentColor" },
      ":focus-visible": "currentColor",
    },
    transitionProperty: "text-decoration-color",
    transitionDuration: {
      default: motion.durationFast,
      ":hover": { "@media (hover: hover) and (pointer: fine)": "0s" },
      ":focus-visible": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "ease-in-out",
  },
  agentIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1em",
    height: "1em",
    verticalAlign: "-0.0714em",
    marginInlineEnd: "0.2857em",
    userSelect: "none",
  },
  chevronTrigger: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    alignSelf: "stretch",
    color: role.contentTertiary,
    "--_chevron": { default: null, ":focus-visible": "1", "[data-panel-open]": "1" },
  },
  output: {
    boxSizing: "border-box",
    maxHeight: 280,
    paddingBlock: 2,
    overflowY: "auto",
    color: role.contentSecondary,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

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

const STARTING: SubagentStatus = { indicator: "running", text: "Starting up" };

export function SubagentCallView({
  session,
  title,
  state,
  cwd,
}: {
  readonly session: SessionId;
  readonly title: string;
  readonly state: ToolState;
  readonly cwd: string | undefined;
}): ReactElement {
  // The parent's list lags the child, and a parent that stopped or was left
  // behind lists no provisional one. The call's state is the parent's, not the
  // child's: it speaks only once the child is known never to have started.
  const listed = useChildSession(session);
  const read = useSession(session);
  const child = listed ?? read.data ?? undefined;
  const openTray = useOpenSubagentTray();

  const subject: SubagentSubject =
    child === undefined
      ? { kind: "call", status: read.data === null ? callStatus(toolStatus(state)) : STARTING }
      : "kind" in child
        ? { kind: "call", status: STARTING }
        : { kind: "session", session: child };

  return (
    <div {...props(subagentCallStyles.root)}>
      <SubagentRow
        title={title}
        subject={subject}
        cwd={cwd}
        open={openTray === undefined ? undefined : () => openTray(session)}
        xstyle={subagentCallStyles.header}
      />
      {subject.kind === "session" && <SubagentNestedRows session={session} cwd={cwd} />}
    </div>
  );
}

/** A call on a child, drawn as a tool line: the verb, then the agent it names, which opens the child. */
export function SubagentLineView({
  toolClass,
  state,
  output,
}: {
  readonly toolClass: DelegateToolClass;
  readonly state: ToolState;
  readonly output: string;
}): ReactElement {
  const status = toolStatus(state);
  const running = status.tense === "running";
  const session = toolClass.target.session;
  const childSession = useChildSession(session);

  const child =
    childSession === undefined
      ? undefined
      : "kind" in childSession
        ? childSession.title
        : childSession.name;

  const openTray = useOpenSubagentTray();
  const label = child ?? "agent";
  const verb = status.tense === "none" ? undefined : DELEGATE_VERBS[toolClass.role][status.tense];
  const expandable = output.trim() !== "";

  const agent = (
    <>
      <span aria-hidden="true" {...props(lineStyles.agentIcon)}>
        <Icon name="agent" size={14} />
      </span>
      {label}
    </>
  );

  const line = (
    <div
      {...props(
        toolLineStyles.line,
        (expandable || openTray !== undefined) && toolLineStyles.clickable,
        status.tone === "stopped" && toolLineStyles.dimmed,
      )}
    >
      {verb !== undefined &&
        (expandable ? (
          <Collapsible.Trigger
            variant="plain"
            tabIndex={-1}
            aria-hidden="true"
            xstyle={[toolLineStyles.action, running && activityStyles.shimmer]}
          >
            {verb}
          </Collapsible.Trigger>
        ) : (
          <span {...props(toolLineStyles.action, running && activityStyles.shimmer)}>{verb}</span>
        ))}
      <span {...props(toolLineStyles.details, lineStyles.detailsRow)}>
        {openTray === undefined ? (
          <span {...props(lineStyles.agent)}>{agent}</span>
        ) : (
          <Row.Primary
            onClick={() => openTray(session)}
            xstyle={[lineStyles.agent, lineStyles.agentButton, focus.ring]}
          >
            {agent}
          </Row.Primary>
        )}
      </span>
      {verb === undefined && (
        <span {...props(toolLineStyles.action)}>{DELEGATE_NOUNS[toolClass.role]}</span>
      )}
      <ToolOutcome status={status} />
      {expandable && (
        <Collapsible.Trigger
          variant="plain"
          aria-label="Show result"
          xstyle={[lineStyles.chevronTrigger, focus.ringInset]}
        >
          <Collapsible.Chevron size={12} xstyle={toolLineStyles.chevron} />
        </Collapsible.Trigger>
      )}
    </div>
  );

  if (!expandable) return line;

  return (
    <Collapsible.Root xstyle={toolLineStyles.root}>
      {line}
      <Collapsible.Panel data-tool-body role="region" aria-label="Result">
        <div data-nyte-scrollport {...props(lineStyles.output)}>
          {output.trimEnd()}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const citationStyles = create({
  popup: { maxWidth: "min(280px, var(--available-width))" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  title: { fontWeight: 500 },
  detail: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: 8,
    color: role.contentSecondary,
  },
  detailText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

function CitationModel({ session }: { readonly session: SessionInfo }): ReactElement | null {
  const catalog = useCatalog(session.sessionId);
  const { model, thinkingLevel } = session.config;
  const name = modelDisplayName(catalog.data, model);

  if (model === undefined || name === undefined) return null;

  return (
    <span {...props(citationStyles.detail)}>
      <Icon name={providerIcon(model.provider ?? "")} size={12} />
      <span {...props(citationStyles.detailText)}>
        {thinkingLevel === undefined || thinkingLevel === "off"
          ? name
          : `${name} ${THINKING_LABELS[thinkingLevel]}`}
      </span>
    </span>
  );
}

/**
 * An agent the prose names as `[label](agent:<id>)`: the agent icon and the
 * model's own words, which fit its sentence. The card carries the agent's
 * title, folder, and model once the session resolves.
 */
export function SubagentCitation({
  session,
  label,
}: {
  readonly session: SessionId;
  readonly label: string;
}): ReactElement {
  const listed = useChildSession(session);
  const read = useSession(session);
  const child = listed ?? read.data ?? undefined;
  const openTray = useOpenSubagentTray();
  const title = child === undefined ? undefined : "kind" in child ? child.title : child.name;
  const text = label === "" || label === session ? (title ?? session) : label;

  const link = (
    <a
      href={`agent:${session}`}
      data-citation="agent"
      {...props(intent.primary, proseStyles.link)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openTray?.(session);
      }}
    >
      <span {...props(proseStyles.linkLead)}>
        <span aria-hidden="true" {...props(proseStyles.linkIcon)}>
          <Icon name="agent" size={12} />
        </span>
        {text}
      </span>
    </a>
  );

  if (child === undefined) return link;

  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={link} />
      <PreviewCardContent side="bottom" align="start" xstyle={citationStyles.popup}>
        <div {...props(citationStyles.card)}>
          <span {...props(citationStyles.title)}>{title ?? text}</span>
          {!("kind" in child) && (
            <>
              <span {...props(citationStyles.detail)}>
                <Icon name="folder" size={12} />
                <span {...props(citationStyles.detailText)}>{child.workspace.cwd}</span>
              </span>
              <CitationModel session={child} />
            </>
          )}
        </div>
      </PreviewCardContent>
    </PreviewCard>
  );
}
