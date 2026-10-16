import { branchSummary, compaction, isPart } from "@nyte-ai/plugin/client";
import type { Message, MessageId, TurnId } from "@nyte-ai/sdk";
import { TextAttributes } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { agentStatus } from "../../lib/tool-card.ts";
import {
  isReport,
  isTextMessage,
  isThinkingMessage,
  isToolMessage,
} from "../../lib/view-helpers.ts";
import type {
  PartMessage,
  ReportMessage,
  ToolMessage,
  UserMessage,
} from "../../lib/view-helpers.ts";
import type { TurnStatus } from "../../model/transcript.ts";
import { AssistantText } from "./assistant-text.tsx";
import { Column } from "./block.tsx";
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
  | { readonly kind: "message"; readonly key: string; readonly id: MessageId }
  | { readonly kind: "agents"; readonly key: string; readonly ids: readonly MessageId[] };

function startsAgent(message: Message | undefined): boolean {
  if (message === undefined || !isToolMessage(message)) return false;
  const toolClass = message.state.class;

  return (
    toolClass.kind === "delegate" && (toolClass.role === "task" || toolClass.role === "create")
  );
}

function segment(
  blocks: readonly MessageId[],
  messages: ReadonlyMap<MessageId, Message>,
): readonly Segment[] {
  const segments: Segment[] = [];
  let run: MessageId[] = [];

  const flush = (): void => {
    const [first] = run;

    if (first !== undefined && run.length === 1)
      segments.push({ kind: "message", key: first, id: first });
    else if (first !== undefined)
      segments.push({ kind: "agents", key: `agents:${first}:${String(run.length)}`, ids: run });
    run = [];
  };

  for (const id of blocks) {
    if (startsAgent(messages.get(id))) {
      run.push(id);
      continue;
    }

    flush();
    segments.push({ kind: "message", key: id, id });
  }

  flush();

  return segments;
}

const UNFINISHED = new Set(["queued", "running", "waiting", "retrying", "stopping"]);

function AgentGroup(props: { readonly ids: readonly MessageId[] }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();

  const header = createMemo(() => {
    const statuses = props.ids.flatMap((id) => {
      const message = scope.model().messages.get(id);

      return message !== undefined && isToolMessage(message)
        ? [agentStatus(message, scope.tasks())]
        : [];
    });

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
    <box id={`agents:${props.ids[0] ?? ""}`} flexDirection="column" width="100%">
      <text wrapMode="none" truncate selectable={false}>
        <span style={{ fg: app.kit.theme().foreground, attributes: TextAttributes.BOLD }}>
          {header().title}
        </span>
        <span style={{ fg: app.kit.theme().dim }}>{header().tail}</span>
      </text>
      <For each={props.ids}>{(id) => <MessageView id={id} />}</For>
    </box>
  );
}

export function TurnView(props: {
  readonly id: TurnId;
  readonly ref?: (node: BoxRenderable) => void;
}): JSX.Element {
  const scope = useTranscript();
  const turn = createMemo(() => scope.model().turns.get(props.id));
  let kept = new Map<string, Segment>();

  const segments = createMemo(() => {
    const next = new Map<string, Segment>();

    const mounted = segment(turn()?.blocks ?? [], scope.model().messages).map((entry) => {
      const known = kept.get(entry.key) ?? entry;
      next.set(entry.key, known);

      return known;
    });

    kept = next;

    return mounted;
  });

  return (
    <Column id={`turn:${props.id}`} ref={props.ref}>
      <For each={segments()}>
        {(entry) =>
          entry.kind === "agents" ? <AgentGroup ids={entry.ids} /> : <MessageView id={entry.id} />
        }
      </For>
      <Show when={turn()?.status}>
        {(status: Accessor<TurnStatus>) => <TurnStatusRow turn={props.id} status={status()} />}
      </Show>
    </Column>
  );
}

function userOf(message: Message): UserMessage | undefined {
  return message.kind === "user" && !isReport(message) ? message : undefined;
}

function reportOf(message: Message): ReportMessage | undefined {
  return message.kind === "user" && isReport(message) ? message : undefined;
}

function toolOf(message: Message): ToolMessage | undefined {
  return isToolMessage(message) ? message : undefined;
}

function proseOf(message: Message): Prose | undefined {
  return isTextMessage(message) ? message : undefined;
}

function thoughtOf(message: Message): Prose | undefined {
  return isThinkingMessage(message) ? message : undefined;
}

function markerOf(message: Message): PartMessage | undefined {
  return isPart(message, compaction) || isPart(message, branchSummary) ? message : undefined;
}

function otherOf(message: Message): PartMessage | undefined {
  return message.kind === "part" ? message : undefined;
}

export function MessageView(props: { readonly id: MessageId }): JSX.Element {
  const scope = useTranscript();
  const message = createMemo(() => scope.model().messages.get(props.id));
  const expanded = createMemo(() => scope.model().toolOutput === "expanded");

  return (
    <Show when={message()}>
      {(current: Accessor<Message>) => (
        <Switch>
          <Match when={reportOf(current())}>
            {(report: Accessor<ReportMessage>) => <ReportBlock message={report()} />}
          </Match>
          <Match when={userOf(current())}>
            {(user: Accessor<UserMessage>) => <UserMessageView message={user()} />}
          </Match>
          <Match when={toolOf(current())}>
            {(tool: Accessor<ToolMessage>) => <ToolCard message={tool()} expanded={expanded()} />}
          </Match>
          <Match when={proseOf(current())}>
            {(text: Accessor<Prose>) => <AssistantText message={text()} />}
          </Match>
          <Match when={thoughtOf(current())}>
            {(thought: Accessor<Prose>) => <Thought message={thought()} expanded={expanded()} />}
          </Match>
          <Match when={markerOf(current())}>
            {(note: Accessor<PartMessage>) => <Marker message={note()} />}
          </Match>
          <Match when={otherOf(current())}>
            {(part: Accessor<PartMessage>) => <PluginPart message={part()} />}
          </Match>
        </Switch>
      )}
    </Show>
  );
}
