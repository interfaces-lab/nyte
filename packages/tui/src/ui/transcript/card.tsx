/** Draws a `ToolCardModel`: the coloured heading, then a text, diff or activity body. */
import type { TextChunk } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { CardBody, HeadingChunk, ToolCardModel } from "../../lib/tool-card.ts";
import { DiffView } from "./diff.tsx";

type TextBody = Extract<CardBody, { readonly kind: "text" }>;

type DiffBody = Extract<CardBody, { readonly kind: "diff" }>;

type ActivityBody = Extract<CardBody, { readonly kind: "activity" }>;

function Panel(props: { readonly text: string; readonly error: boolean }): JSX.Element {
  const { kit } = useApp();

  return (
    <box paddingLeft={2} width="100%" backgroundColor={kit.theme().codeBackground}>
      <code
        content={props.text}
        syntaxStyle={kit.syntax().normal}
        conceal={false}
        fg={props.error ? kit.theme().error : kit.theme().dim}
        bg={kit.theme().codeBackground}
        wrapMode="none"
        truncate
        selectionBg={kit.theme().selectionBackground}
        selectionFg={kit.theme().selectionForeground}
        width="100%"
      />
    </box>
  );
}

/** A heading word; a shell command takes bash highlights once they land and stays plain until then. */
function Chunk(props: { readonly chunk: HeadingChunk }): JSX.Element {
  const { kit } = useApp();

  const highlighted = () => {
    const { code, text } = props.chunk;

    return code === undefined ? null : kit.highlight(text, code);
  };

  return (
    <Show
      when={highlighted()}
      fallback={<span style={{ fg: kit.theme()[props.chunk.role] }}>{props.chunk.text}</span>}
    >
      {(chunks: Accessor<readonly TextChunk[]>) => (
        <For each={chunks()}>
          {(chunk) => <span style={{ fg: chunk.fg, bg: chunk.bg }}>{chunk.text}</span>}
        </For>
      )}
    </Show>
  );
}

export function CardView(props: {
  readonly id: string;
  readonly card: ToolCardModel;
}): JSX.Element {
  const { kit } = useApp();

  return (
    <box id={props.id} flexDirection="column" width="100%">
      <text wrapMode="none" truncate>
        <For each={props.card.heading}>{(chunk) => <Chunk chunk={chunk} />}</For>
      </text>
      <Switch>
        <Match when={props.card.body.kind === "text" ? props.card.body : undefined}>
          {(body: Accessor<TextBody>) => (
            <box paddingLeft={2} width="100%" backgroundColor={kit.theme().codeBackground}>
              <code
                content={body().text}
                filetype={body().filetype}
                syntaxStyle={kit.syntax().normal}
                conceal={false}
                fg={body().role === "error" ? kit.theme().error : kit.theme().dim}
                bg={kit.theme().codeBackground}
                wrapMode="none"
                truncate
                selectionBg={kit.theme().selectionBackground}
                selectionFg={kit.theme().selectionForeground}
                width="100%"
              />
            </box>
          )}
        </Match>
        <Match when={props.card.body.kind === "diff" ? props.card.body : undefined}>
          {(body: Accessor<DiffBody>) => (
            <box flexDirection="column" width="100%" backgroundColor={kit.theme().codeBackground}>
              <Show when={body().before}>
                {(text: Accessor<string>) => <Panel text={text()} error={false} />}
              </Show>
              <DiffView diff={body().diff} />
              <Show when={body().after}>
                {(text: Accessor<string>) => <Panel text={text()} error={false} />}
              </Show>
            </box>
          )}
        </Match>
        <Match when={props.card.body.kind === "activity" ? props.card.body : undefined}>
          {(body: Accessor<ActivityBody>) => (
            <box paddingLeft={2} width="100%" height={1}>
              <text fg={kit.theme().dim} wrapMode="none" truncate selectable={false}>
                {body().text}
              </text>
            </box>
          )}
        </Match>
      </Switch>
    </box>
  );
}
