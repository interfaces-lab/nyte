import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type {
  MessageSource,
  RunEnd,
  SessionId,
  SessionInfo,
  ToolClass,
  UserContent,
} from "@nyte-ai/sdk";
import { toolNoun, toolStatus, toolVerbs } from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { TextRoll } from "../components/text-roll.tsx";
import { UnreadMark } from "../components/ui.tsx";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Row } from "@nyte-ai/ui/row";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  useCatalog,
  useChildSessions,
  useSession,
  useSessionActivity,
  useSessionChoice,
  useWorkspaces,
} from "../queries.ts";
import { sessionHasUnreadCompletion } from "../session-read-state.ts";
import { modelDisplayName, modelIcon, THINKING_LABELS } from "./model-picker-state.ts";
import { activityStyles } from "./activity.stylex.ts";
import { proseStyles } from "./prose.stylex.ts";
import { subagentCallStyles } from "./subagent-call.stylex.ts";
import {
  useCalledChild,
  useChildSession,
  useOpenSubagentTray,
  useSubagentChildren,
} from "./subagent-sessions.ts";
import { callStatus, sessionStatus } from "./subagent-status.ts";
import type { SubagentStatus } from "./subagent-status.ts";
import { ToolOutcome, toolLineStyles } from "./tool-line.tsx";
import { useCommitCount } from "../work-counts.ts";

type DelegateToolClass = Extract<ToolClass, { readonly kind: "delegate" }>;

const lineStyles = create({
  detailsRow: { display: "flex", alignItems: "center", gap: space.s1 },
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
      ":hover": { [media.hover]: "currentColor" },
      ":focus-visible": "currentColor",
    },
    transitionProperty: "text-decoration-color",
    transitionDuration: {
      default: motion.durationFast,
      ":hover": { [media.hover]: "0s" },
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
    paddingBlock: space.s0_5,
    overflowY: "auto",
    color: role.contentSecondary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

type SubagentSubject =
  | { readonly kind: "session"; readonly session: SessionInfo }
  | { readonly kind: "call"; readonly status: SubagentStatus };

function SubagentModel({ session }: { readonly session: SessionInfo }): ReactElement | null {
  const catalog = useCatalog();
  const choice = useSessionChoice(session.id);
  const name = modelDisplayName(catalog.data, choice?.model);

  if (name === undefined) return null;

  return <span {...props(subagentCallStyles.model)}>{name}</span>;
}

function SubagentStatusLine({
  status,
  watched,
  cwd,
}: {
  readonly status: SubagentStatus;
  readonly watched: SessionId | undefined;
  readonly cwd: string | undefined;
}): ReactElement {
  const activity = useSessionActivity(watched, cwd);
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
  useCommitCount("render:agent-row");
  const status =
    subject.kind === "session"
      ? sessionStatus(subject.session, sessionHasUnreadCompletion(subject.session))
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
                ? subject.session.id
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
            key={child.id}
            title={child.name ?? "Subagent"}
            subject={{ kind: "session", session: child }}
            cwd={cwd}
            open={openTray === undefined ? undefined : () => openTray(child.id)}
            xstyle={subagentCallStyles.nestedRow}
          />
        ))}
    </div>
  );
}

export function SubagentCallView({
  title,
  message,
  cwd,
}: {
  readonly title: string;
  readonly message: ToolMessage;
  readonly cwd: string | undefined;
}): ReactElement {
  useCommitCount("render:agent-call");
  const child = useCalledChild(message.state.call);
  const tray = useOpenSubagentTray();
  const open = child === undefined || tray === undefined ? undefined : () => tray(child.id);

  return (
    <div {...props(subagentCallStyles.root)}>
      <SubagentRow
        title={child?.name ?? title}
        subject={
          child === undefined
            ? { kind: "call", status: callStatus(toolStatus(message)) }
            : { kind: "session", session: child }
        }
        cwd={cwd}
        open={open}
        xstyle={subagentCallStyles.header}
      />
      {child !== undefined && <SubagentNestedRows session={child.id} cwd={cwd} />}
    </div>
  );
}

export function SubagentGroupView({
  messages,
  cwd,
}: {
  readonly messages: readonly ToolMessage[];
  readonly cwd: string | undefined;
}): ReactElement {
  useCommitCount("render:agent-group");
  const indicators = useSubagentChildren((children) =>
    messages.map((message) => {
      const child = children.find((candidate) => candidate.call === message.state.call);

      return child === undefined
        ? callStatus(toolStatus(message)).indicator
        : sessionStatus(child, false).indicator;
    }),
  );

  const total = messages.length;

  const running = indicators.filter(
    (indicator) => indicator === "running" || indicator === "attention",
  ).length;

  const failed = indicators.filter((indicator) => indicator === "failed").length;

  const title =
    running > 0
      ? `Running ${String(total)} agents…`
      : `${String(total)} agents ${failed === 0 ? "completed" : "finished"}`;

  const detail =
    running > 0
      ? running === total
        ? undefined
        : `(${String(total - running)} done)`
      : failed === 0
        ? undefined
        : `· ${String(failed)} failed`;

  return (
    <div {...props(subagentCallStyles.root)}>
      <div {...props(toolLineStyles.line)}>
        <span {...props(toolLineStyles.action, running > 0 && activityStyles.shimmer)}>
          {title}
        </span>
        {detail !== undefined && <span {...props(toolLineStyles.outcome)}>{detail}</span>}
      </div>
      {messages.map((message) => {
        const toolClass = message.state.class;

        return (
          <SubagentCallView
            key={message.id}
            title={toolClass.kind === "delegate" ? (toolClass.title ?? "Subagent") : "Subagent"}
            message={message}
            cwd={cwd}
          />
        );
      })}
    </div>
  );
}

export function SubagentLineView({
  toolClass,
  message,
  output,
}: {
  readonly toolClass: DelegateToolClass;
  readonly message: ToolMessage;
  readonly output: string;
}): ReactElement {
  const status = toolStatus(message);
  const running = status.tense === "running";
  const session = toolClass.child ?? undefined;
  const child = useChildSession(session)?.name ?? undefined;
  const tray = useOpenSubagentTray();
  const openTray = session === undefined ? undefined : tray;
  const label = child ?? toolClass.title ?? "agent";
  const verb = status.tense === "none" ? undefined : toolVerbs(toolClass)[status.tense];
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
            onClick={() => {
              if (session !== undefined) openTray(session);
            }}
            xstyle={[lineStyles.agent, lineStyles.agentButton, focus.ring]}
          >
            {agent}
          </Row.Primary>
        )}
      </span>
      {verb === undefined && <span {...props(toolLineStyles.action)}>{toolNoun(toolClass)}</span>}
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

const REPORT_VERBS = {
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
} satisfies Readonly<Record<RunEnd["kind"], string>>;

export function SubagentReportLine({
  source,
  content,
  held,
}: {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
  readonly content: UserContent;
  readonly held: boolean;
}): ReactElement {
  const child = useChildSession(source.kind === "child" ? source.session : undefined);
  const tray = useOpenSubagentTray();

  const open =
    source.kind === "child" && tray !== undefined ? () => tray(source.session) : undefined;

  const label =
    source.kind === "child" ? (
      <>
        <span aria-hidden="true" {...props(lineStyles.agentIcon)}>
          <Icon name="agent" size={14} />
        </span>
        {child?.name ?? "Subagent"}
      </>
    ) : (
      ((typeof content === "string"
        ? content
        : content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("")
      ).split("\n")[0] ?? "")
    );

  return (
    <div
      {...props(
        toolLineStyles.line,
        open !== undefined && toolLineStyles.clickable,
        source.kind === "child" && source.end === "stopped" && toolLineStyles.dimmed,
      )}
    >
      {source.kind === "child" && (
        <span {...props(source.end === "failed" && intent.danger, toolLineStyles.action)}>
          {REPORT_VERBS[source.end]}
        </span>
      )}
      <span {...props(toolLineStyles.details, lineStyles.detailsRow)}>
        {open === undefined ? (
          <span {...props(lineStyles.agent)}>{label}</span>
        ) : (
          <Row.Primary
            onClick={open}
            xstyle={[lineStyles.agent, lineStyles.agentButton, focus.ring]}
          >
            {label}
          </Row.Primary>
        )}
      </span>
      {held && (
        <span {...props(intent.warning, toolLineStyles.outcome)}>
          · Held until your next message
        </span>
      )}
    </div>
  );
}

const citationStyles = create({
  popup: { maxWidth: "min(280px, var(--available-width))" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
  },
  title: { fontWeight: type.weightMedium },
  detail: {
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: space.s2,
    color: role.contentSecondary,
  },
  detailText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

function CitationModel({ session }: { readonly session: SessionInfo }): ReactElement | null {
  const catalog = useCatalog();
  const choice = useSessionChoice(session.id);
  const model = choice?.model;
  const thinkingLevel = choice?.thinking;
  const name = modelDisplayName(catalog.data, model);

  if (model === undefined || name === undefined) return null;

  return (
    <span {...props(citationStyles.detail)}>
      <Icon name={modelIcon(model)} size={12} />
      <span {...props(citationStyles.detailText)}>
        {thinkingLevel === undefined || thinkingLevel === "off"
          ? name
          : `${name} ${THINKING_LABELS[thinkingLevel]}`}
      </span>
    </span>
  );
}

function CitationFolder({ session }: { readonly session: SessionInfo }): ReactElement {
  const workspace = useWorkspaces().data?.find((candidate) => candidate.id === session.workspace);
  const branch = workspace?.worktree?.branch;

  return (
    <span title={workspace?.path} {...props(citationStyles.detail)}>
      <Icon name={branch === undefined ? "folder" : "git-branch"} size={12} />
      <span {...props(citationStyles.detailText)}>{branch ?? workspace?.name ?? ""}</span>
    </span>
  );
}

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
  const title = child?.name ?? undefined;
  const name = label === "" || label === session ? (title ?? session) : label;

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
        {name}
      </span>
    </a>
  );

  if (child === undefined) return link;

  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={link} />
      <PreviewCardContent side="bottom" align="start" xstyle={citationStyles.popup}>
        <div {...props(text.sm, citationStyles.card)}>
          <span {...props(citationStyles.title)}>{title ?? name}</span>
          <CitationFolder session={child} />
          <CitationModel session={child} />
        </div>
      </PreviewCardContent>
    </PreviewCard>
  );
}
