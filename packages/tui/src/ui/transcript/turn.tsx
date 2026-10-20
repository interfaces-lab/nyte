import { branchSummary, compaction, isPart } from "@nyte-ai/plugin/client";
import type { Message } from "@nyte-ai/sdk";
import { TextAttributes } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import {
  showsReport,
  showsText,
  showsThinking,
  showsTool,
} from "@nyte-ai/plugin/client/presentation";
import type {
  PartMessage,
  ReportMessage,
  ToolMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import { agentStatus } from "../../lib/tool-card.ts";
import type { TurnModel, TurnStatus } from "../../model/transcript.ts";
import { AssistantText } from "./assistant-text.tsx";
import { Column } from "./block.tsx";
import { Keyed } from "./keyed.tsx";
import { Marker } from "./marker.tsx";
import { PluginPart } from "./plugin-part.tsx";
import { ReportBlock } from "./report.tsx";
import { useTranscript } from "./scope.tsx";
import { Thought } from "./thought.tsx";
import { ToolCard } from "./tool-card.tsx";
import { TurnStatusRow } from "./turn-status.tsx";
import { UserMessageView } from "./user-message.tsx";

type Prose = PartMessage & { readonly state: { readonly markdown: string } };

type Segment =
  | { readonly kind: "message"; readonly key: string; readonly message: Message }
  | { readonly kind: "agents"; readonly key: string; readonly messages: readonly Message[] }
  | { readonly kind: "earlier"; readonly key: string };

function startsAgent(message: Message): boolean {
  if (!showsTool(message)) return false;
  const toolClass = message.state.class;

  return (
    toolClass.kind === "delegate" && (toolClass.role === "task" || toolClass.role === "create")
  );
}

function segment(blocks: readonly Message[]): readonly Segment[] {
  const segments: Segment[] = [];
  let run: Message[] = [];

  const flush = (): void => {
    const [first] = run;

    if (first !== undefined && run.length === 1)
      segments.push({ kind: "message", key: first.id, message: first });
    else if (first !== undefined)
      segments.push({
        kind: "agents",
        key: `agents:${first.id}:${String(run.length)}`,
        messages: run,
      });
    run = [];
  };

  for (const message of blocks) {
    if (startsAgent(message)) {
      run.push(message);
      continue;
    }

    flush();
    segments.push({ kind: "message", key: message.id, message });
  }

  flush();

  return segments;
}

const UNFINISHED = new Set(["queued", "running", "waiting", "retrying", "stopping"]);

function AgentGroup(props: { readonly messages: readonly Message[] }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();

  const header = createMemo(() => {
    const statuses = props.messages.flatMap((message) =>
      showsTool(message) ? [agentStatus(message, scope.tasks())] : [],
    );

    const total = statuses.length;
    const running = statuses.filter((status) => UNFINISHED.has(status)).length;

    if (running > 0)
      return {
        title: `Running ${String(total)} agents…`,
        tail: running === total ? "" : ` (${String(total - running)} done)`,
      };
    const failed = statuses.filter((status) => status === "failed").length;
    const stopped = statuses.filter((status) => status === "stopped").length;

    return {
      title: `${String(total)} agents ${failed + stopped === 0 ? "completed" : "finished"}`,
      tail: [
        failed === 0 ? "" : ` · ${String(failed)} failed`,
        stopped === 0 ? "" : ` · ${String(stopped)} stopped`,
      ].join(""),
    };
  });

  return (
    <box id={`agents:${props.messages[0]?.id ?? ""}`} flexDirection="column" width="100%">
      <text wrapMode="none" truncate selectable={false}>
        <span style={{ fg: app.kit.theme().foreground, attributes: TextAttributes.BOLD }}>
          {header().title}
        </span>
        <span style={{ fg: app.kit.theme().dim }}>{header().tail}</span>
      </text>
      <Keyed each={props.messages} by={(message) => message.id}>
        {(message) => <MessageView message={message} />}
      </Keyed>
    </box>
  );
}

function SegmentView(props: { readonly segment: Accessor<Segment> }): JSX.Element {
  const app = useApp();

  const single = createMemo(() => {
    const current = props.segment();

    return current.kind === "message" ? current.message : undefined;
  });

  const group = createMemo(() => {
    const current = props.segment();

    return current.kind === "agents" ? current.messages : undefined;
  });

  return (
    <Switch>
      <Match when={single()}>
        {(message: Accessor<Message>) => <MessageView message={message} />}
      </Match>
      <Match when={group()}>
        {(messages: Accessor<readonly Message[]>) => <AgentGroup messages={messages()} />}
      </Match>
      <Match when={props.segment().kind === "earlier"}>
        <text
          id={props.segment().key}
          fg={app.kit.theme().dim}
          wrapMode="none"
          truncate
          selectable={false}
        >
          earlier steps not shown
        </text>
      </Match>
    </Switch>
  );
}

export function TurnView(props: {
  readonly turn: Accessor<TurnModel>;
  readonly ref?: (node: BoxRenderable) => void;
}): JSX.Element {
  const id = props.turn().info.id;

  const segments = createMemo(() => {
    const { blocks, clipped } = props.turn();

    return segment(blocks).flatMap((entry, index): readonly Segment[] =>
      clipped && index === 0 ? [entry, { kind: "earlier", key: `earlier:${id}` }] : [entry],
    );
  });

  return (
    <Column id={`turn:${id}`} ref={props.ref}>
      <Keyed each={segments()} by={(entry) => entry.key}>
        {(entry) => <SegmentView segment={entry} />}
      </Keyed>
      <Show when={props.turn().status}>
        {(status: Accessor<TurnStatus>) => <TurnStatusRow turn={id} status={status()} />}
      </Show>
    </Column>
  );
}

function readUser(message: Message): UserMessage | undefined {
  return message.kind === "user" && !showsReport(message) ? message : undefined;
}

function readReport(message: Message): ReportMessage | undefined {
  return message.kind === "user" && showsReport(message) ? message : undefined;
}

function readTool(message: Message): ToolMessage | undefined {
  return showsTool(message) ? message : undefined;
}

function readProse(message: Message): Prose | undefined {
  return showsText(message) ? message : undefined;
}

function readThought(message: Message): Prose | undefined {
  return showsThinking(message) ? message : undefined;
}

function readMarker(message: Message): PartMessage | undefined {
  return isPart(message, compaction) || isPart(message, branchSummary) ? message : undefined;
}

function readPart(message: Message): PartMessage | undefined {
  return message.kind === "part" ? message : undefined;
}

export function MessageView(props: { readonly message: Accessor<Message> }): JSX.Element {
  const scope = useTranscript();
  const expanded = createMemo(() => scope.model().toolOutput === "expanded");

  return (
    <Switch>
      <Match when={readReport(props.message())}>
        {(report: Accessor<ReportMessage>) => <ReportBlock message={report()} />}
      </Match>
      <Match when={readUser(props.message())}>
        {(user: Accessor<UserMessage>) => <UserMessageView message={user()} />}
      </Match>
      <Match when={readTool(props.message())}>
        {(tool: Accessor<ToolMessage>) => <ToolCard message={tool()} expanded={expanded()} />}
      </Match>
      <Match when={readProse(props.message())}>
        {(text: Accessor<Prose>) => <AssistantText message={text()} />}
      </Match>
      <Match when={readThought(props.message())}>
        {(thought: Accessor<Prose>) => <Thought message={thought()} expanded={expanded()} />}
      </Match>
      <Match when={readMarker(props.message())}>
        {(note: Accessor<PartMessage>) => <Marker message={note()} />}
      </Match>
      <Match when={readPart(props.message())}>
        {(part: Accessor<PartMessage>) => <PluginPart message={part()} />}
      </Match>
    </Switch>
  );
}
