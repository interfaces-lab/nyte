/**
 * A turn: its blocks in view order, then its status row, always last. Blocks
 * are keyed by message id; each block reads its Message from the model by id,
 * and the SDK keeps unchanged messages identical, so a streaming delta
 * re-renders one block.
 */
import { branchSummary, compaction, isPart } from "@nyte-ai/plugin/client";
import type { Message, MessageId, TurnId } from "@nyte-ai/sdk";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
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

export function TurnView(props: {
  readonly id: TurnId;
  readonly ref?: (node: BoxRenderable) => void;
}): JSX.Element {
  const scope = useTranscript();
  const turn = createMemo(() => scope.model().turns.get(props.id));

  return (
    <Column id={`turn:${props.id}`} ref={props.ref}>
      <For each={turn()?.blocks ?? []}>{(id) => <MessageView id={id} />}</For>
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

/**
 * user → isReport ? <ReportBlock> : <UserMessageView>   (reports never draw as the user's message)
 * part → text <AssistantText> · thinking <Thought> · tool <ToolCard> · compaction/branchSummary <Marker>
 *        · otherwise <PluginPart> (plugin renderer inside its own ErrorBoundary, fallback dim [partKind])
 */
export function MessageView(props: { readonly id: MessageId }): JSX.Element {
  const scope = useTranscript();
  const message = createMemo(() => scope.model().messages.get(props.id));
  const expanded = (): boolean => scope.model().toolOutput === "expanded";

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
