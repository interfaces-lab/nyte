import { treeSitterToTextChunks } from "@opentui/core";
import type { SimpleHighlight, TextChunk } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
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

/** A heading chunk; a code chunk asks for its highlights while it is mounted and colors itself once they land. */
function Chunk(props: { readonly chunk: HeadingChunk }): JSX.Element {
  const { kit } = useApp();
  const [ranges, setRanges] = createSignal<readonly SimpleHighlight[]>([]);

  const code = createMemo(() => props.chunk.code);
  const text = createMemo(() => props.chunk.text);

  createEffect(
    on([code, text], ([filetype, label]) => {
      setRanges([]);

      if (filetype === undefined) return;
      let mounted = true;

      onCleanup(() => {
        mounted = false;
      });
      void kit.highlight(label, filetype).then((found) => {
        if (mounted) setRanges(found);
      });
    }),
  );

  const highlighted = (): readonly TextChunk[] | null => {
    const found = ranges();

    return found.length === 0
      ? null
      : treeSitterToTextChunks(props.chunk.text, [...found], kit.syntax().normal, {
          enabled: false,
        });
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
        <Index each={props.card.heading}>{(chunk) => <Chunk chunk={chunk()} />}</Index>
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
