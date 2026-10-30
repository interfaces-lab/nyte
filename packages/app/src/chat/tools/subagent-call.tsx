import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { MessageSource, SessionId, ToolClass, UserContent } from "@nyte-ai/sdk";
import {
  agentGroupSummary,
  callTaskState,
  taskEnded,
  taskLabel,
  toolNoun,
  toolStatus,
  toolVerbs,
} from "@nyte-ai/plugin/client/presentation";
import type { TaskState, ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { TextRoll } from "../../components/text-roll.tsx";
import { TaskMark } from "../../components/task-mark.tsx";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@nyte-ai/ui/preview-card";
import { Row } from "@nyte-ai/ui/row";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useCatalog } from "../../data/catalog.ts";
import { useSessionActivity, useSessionChoice } from "../../data/sessions.ts";
import {
  childTitle,
  delegateKey,
  findTask,
  useChat,
  useChatTasks,
  useChildTasks,
  useTask,
} from "../../chats/index.ts";
import type { Chat, ChildTask, Task } from "../../chats/index.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import { useChatWindow } from "../../window/index.ts";
import { modelDisplayName, modelIcon, THINKING_LABELS } from "../composer/model-picker-state.ts";
import { activityStyles } from "../transcript/activity.stylex.ts";
import { useTranscriptScope } from "../transcript/transcript.tsx";
import { proseStyles } from "../markdown/prose.stylex.ts";
import { openJobOutput } from "./job-output.ts";
import { subagentCallStyles } from "./subagent-call.stylex.ts";
import { ToolOutcome, toolLineStyles } from "./tool-line.tsx";
import { useCommitCount } from "../../lib/work-counts.ts";

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

/** Opens a child chat from a link in its parent: a preview tab right after the parent's with a tab strip, else the chat in its pane. */
function openChild(child: SessionId): void {
  windowTabs.openChat(child, "next-to-parent");
}

function SubagentModel({ session }: { readonly session: SessionId }): ReactElement | null {
  const catalog = useCatalog();
  const choice = useSessionChoice(session);
  const name = modelDisplayName(catalog.data, choice?.model);

  if (name === undefined) return null;

  return <span {...props(subagentCallStyles.model)}>{name}</span>;
}

function SubagentStatusLine({
  state,
  words,
  watched,
  cwd,
}: {
  readonly state: TaskState;
  readonly words: string;
  readonly watched: SessionId | undefined;
  readonly cwd: string | undefined;
}): ReactElement {
  const activity = useSessionActivity(watched, cwd);

  return (
    <span
      {...props(
        subagentCallStyles.status,
        state === "waiting" && intent.warning,
        state === "waiting" && subagentCallStyles.statusAttention,
      )}
    >
      <TextRoll
        text={activity ?? words}
        itemStyle={state === "working" ? activityStyles.shimmer : undefined}
      />
    </span>
  );
}

/** A child's row: its task once the host lists it, else what its call says, starting up while it runs. */
function SubagentRow({
  title,
  task,
  callState,
  cwd,
  xstyle,
}: {
  readonly title: string;
  readonly task: ChildTask | undefined;
  readonly callState: TaskState;
  readonly cwd: string | undefined;
  readonly xstyle: StyleXStyles;
}): ReactElement {
  useCommitCount("render:agent-row");
  const id = task?.id;
  const unread = useChatWindow((snapshot) => id !== undefined && snapshot.unread.has(id));
  const state = task?.state ?? callState;
  const words = task === undefined && state === "working" ? "Starting up" : taskLabel(state);

  const content = (
    <>
      <span aria-hidden="true" {...props(subagentCallStyles.indicator)}>
        <TaskMark state={state} unread={unread} />
      </span>
      <span {...props(subagentCallStyles.text)}>
        <span {...props(subagentCallStyles.titleRow)}>
          <span {...props(subagentCallStyles.title)}>{title}</span>
          {id !== undefined && <SubagentModel session={id} />}
        </span>
        <SubagentStatusLine
          state={state}
          words={words}
          watched={state === "working" ? id : undefined}
          cwd={cwd}
        />
      </span>
    </>
  );

  if (id === undefined) return <div {...props(subagentCallStyles.row, xstyle)}>{content}</div>;

  return (
    <Row.Primary
      onClick={() => openChild(id)}
      xstyle={[subagentCallStyles.row, xstyle, focus.ring]}
    >
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
  const children = useChildTasks(session);

  if (children.length === 0) return null;

  return (
    <div {...props(subagentCallStyles.nested)}>
      {children.map((child) => (
        <SubagentRow
          key={child.id}
          title={child.title}
          task={child}
          callState={child.state}
          cwd={cwd}
          xstyle={subagentCallStyles.nestedRow}
        />
      ))}
    </div>
  );
}

function asChild(task: Task | undefined): ChildTask | undefined {
  return task?.kind === "child" ? task : undefined;
}

export function SubagentCallView({
  message,
  toolClass,
  cwd,
}: {
  readonly message: ToolMessage;
  readonly toolClass: DelegateToolClass;
  readonly cwd: string | undefined;
}): ReactElement {
  useCommitCount("render:agent-call");
  const session = useTranscriptScope()?.sessionId;
  const task = asChild(useTask(session, delegateKey(toolClass, message.state.call)));

  return (
    <div {...props(subagentCallStyles.root)}>
      <SubagentRow
        title={task?.title ?? childTitle(undefined, toolClass.title)}
        task={task}
        callState={callTaskState(toolStatus(message))}
        cwd={cwd}
        xstyle={subagentCallStyles.header}
      />
      {task !== undefined && <SubagentNestedRows session={task.id} cwd={cwd} />}
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
  const session = useTranscriptScope()?.sessionId;
  const tasks = useChatTasks(session);

  const states = messages.map((message) => {
    const toolClass = message.state.class;

    const task =
      toolClass.kind === "delegate"
        ? findTask(tasks, delegateKey(toolClass, message.state.call))
        : undefined;

    return task?.state ?? callTaskState(toolStatus(message));
  });

  const summary = agentGroupSummary(states);
  const going = states.some((state) => !taskEnded(state));

  return (
    <div {...props(subagentCallStyles.root)}>
      {messages.length > 1 && (
        <div {...props(toolLineStyles.line)}>
          <span {...props(toolLineStyles.action, going && activityStyles.shimmer)}>
            {summary.title}
          </span>
          {summary.detail !== undefined && (
            <span {...props(toolLineStyles.outcome)}>{summary.detail}</span>
          )}
        </div>
      )}
      {messages.map((message) => {
        const toolClass = message.state.class;

        return toolClass.kind === "delegate" ? (
          <SubagentCallView key={message.id} message={message} toolClass={toolClass} cwd={cwd} />
        ) : null;
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
  const session = useTranscriptScope()?.sessionId;
  const task = asChild(useTask(session, delegateKey(toolClass, message.state.call)));
  const child = task?.id ?? toolClass.child ?? undefined;
  const label = task?.title ?? childTitle(undefined, toolClass.title);
  const verb = status.tense === "none" ? undefined : toolVerbs(toolClass)[status.tense];
  const expandable = output.trim() !== "";

  const agent = (
    <>
      <span aria-hidden="true" {...props(lineStyles.agentIcon)}>
        <Icon name="agent" size="sm" />
      </span>
      {label}
    </>
  );

  const line = (
    <div
      {...props(
        toolLineStyles.line,
        (expandable || child !== undefined) && toolLineStyles.clickable,
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
        {child === undefined ? (
          <span {...props(lineStyles.agent)}>{agent}</span>
        ) : (
          <Row.Primary
            onClick={() => openChild(child)}
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
          <Collapsible.Chevron size="xs" xstyle={toolLineStyles.chevron} />
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

/** The words a job's report starts with: its first line. */
function reportTitle(content: UserContent): string {
  const words =
    typeof content === "string"
      ? content
      : content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("");

  return words.split("\n")[0] ?? "";
}

/**
 * The line a child's or a job's report shows: how it ended and what it is, opening the child's
 * chat or the job's output. A job the host no longer keeps says its output is gone.
 */
export function SubagentReportLine({
  source,
  content,
  held,
}: {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
  readonly content: UserContent;
  readonly held: boolean;
}): ReactElement {
  const session = useTranscriptScope()?.sessionId;

  const task = useTask(
    session,
    source.kind === "child"
      ? { kind: "child", id: source.session }
      : { kind: "job", id: source.job },
  );

  const job = task?.kind === "job" ? task.job : undefined;

  const state =
    source.kind === "child" ? (source.end === "failed" ? "failed" : "done") : task?.state;

  const open =
    source.kind === "child"
      ? () => openChild(source.session)
      : job === undefined || job === null || session === undefined
        ? undefined
        : () => openJobOutput(session, job);

  const label =
    source.kind === "child" ? (
      <>
        <span aria-hidden="true" {...props(lineStyles.agentIcon)}>
          <Icon name="agent" size="sm" />
        </span>
        {task?.title ?? childTitle(undefined)}
      </>
    ) : (
      (task?.title ?? reportTitle(content))
    );

  return (
    <div {...props(toolLineStyles.line, open !== undefined && toolLineStyles.clickable)}>
      {state !== undefined && (
        <span {...props(state === "failed" && intent.danger, toolLineStyles.action)}>
          {taskLabel(state)}
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
      {source.kind === "job" && (task === undefined || job === null) && (
        <span {...props(toolLineStyles.outcome)}>· Output no longer available</span>
      )}
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

function CitationModel({ session }: { readonly session: SessionId }): ReactElement | null {
  const catalog = useCatalog();
  const choice = useSessionChoice(session);
  const model = choice?.model;
  const thinkingLevel = choice?.thinking;
  const name = modelDisplayName(catalog.data, model);

  if (model === undefined || name === undefined) return null;

  return (
    <span {...props(citationStyles.detail)}>
      <Icon name={modelIcon(model)} size="xs" />
      <span {...props(citationStyles.detailText)}>
        {thinkingLevel === undefined || thinkingLevel === "off"
          ? name
          : `${name} ${THINKING_LABELS[thinkingLevel]}`}
      </span>
    </span>
  );
}

function CitationFolder({ chat }: { readonly chat: Chat }): ReactElement | null {
  const location = chat.location;

  if (location.kind !== "folder") return null;
  const branch = location.worktree?.branch;

  return (
    <span title={location.path} {...props(citationStyles.detail)}>
      <Icon name={branch === undefined ? "folder" : "git-branch"} size="xs" />
      <span {...props(citationStyles.detailText)}>{branch ?? location.name}</span>
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
  const found = useChat(session);
  const chat = found.kind === "ready" ? found.chat : undefined;
  const title = childTitle(chat);
  const name = label === "" || label === session ? title : label;
  const state = chat?.mark ?? "done";

  const link = (
    <a
      href={`agent:${session}`}
      data-citation="agent"
      {...props(intent.primary, proseStyles.link)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openChild(session);
      }}
    >
      <span {...props(proseStyles.linkLead)}>
        <span aria-hidden="true" {...props(proseStyles.linkIcon)}>
          {state === "done" ? <Icon name="agent" size="xs" /> : <TaskMark state={state} />}
        </span>
        {name}
      </span>
    </a>
  );

  if (chat === undefined) return link;

  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={link} />
      <PreviewCardContent side="bottom" align="start" xstyle={citationStyles.popup}>
        <div {...props(text.sm, citationStyles.card)}>
          <span {...props(citationStyles.title)}>{title}</span>
          <CitationFolder chat={chat} />
          <CitationModel session={session} />
        </div>
      </PreviewCardContent>
    </PreviewCard>
  );
}
