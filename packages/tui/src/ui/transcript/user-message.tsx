/**
 * A landed user message. `shownContent` (an action's label, never its
 * prompt) through `userPresentation` (lib/presentation.ts): text, tags for
 * skills, files, mentions, images and `!` shell blocks, paste fold at more
 * than 8 lines. Full width of its column; no margin of its own.
 */
import { basename } from "node:path";
import type { JSX } from "@opentui/solid";
import { pathToFiletype } from "@opentui/core";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { userPresentation } from "../../lib/presentation.ts";
import type { AttachedFile, PresentedFile, PresentedShell } from "../../lib/presentation.ts";
import { shownContent } from "../../lib/view-helpers.ts";
import type { UserMessage } from "../../lib/view-helpers.ts";
import { PASTE_COLLAPSE_LINES } from "../../model/draft.ts";
import { useTranscript } from "./scope.tsx";

const PASTE_PREVIEW_LINES = 3;

function lineCount(text: string): number {
  return text.split("\n").length;
}

/** A clickable tag that folds or opens what the message carried; clicks under a selection are ignored. */
function Tag(props: { readonly label: string; readonly onClick: () => void }): JSX.Element {
  const app = useApp();
  const [hovered, setHovered] = createSignal(false);

  return (
    <text
      fg={app.kit.theme().pasteForeground}
      bg={hovered() ? app.kit.theme().hover : app.kit.theme().pasteBackground}
      wrapMode="none"
      selectable={false}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        if (app.screen().selectionActive) return;
        props.onClick();
      }}
    >
      {props.label}
    </text>
  );
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];

  for await (const chunk of chunks) parts.push(chunk);
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return bytes;
}

function ImageBody(props: { readonly image: AttachedFile }): JSX.Element {
  const { kit } = useApp();
  const [bytes] = createResource(
    () => props.image.blob,
    (id) => collect(kit.blob(id)),
  );

  return (
    <Show when={bytes()}>
      {(source: Accessor<Uint8Array>) => (
        <image source={source()} width="100%" height={12} fit="fit" />
      )}
    </Show>
  );
}

export function UserMessageView(props: { readonly message: UserMessage }): JSX.Element {
  const app = useApp();
  const scope = useTranscript();
  const theme = (): ReturnType<typeof app.kit.theme> => app.kit.theme();
  const presentation = createMemo(() => userPresentation(shownContent(props.message)));
  const open = (local: string): boolean =>
    scope.model().disclosures.has(`${props.message.id}:${local}`);
  const toggle = (local: string): void =>
    app.dispatch({ kind: "toggle-disclosure", key: `${props.message.id}:${local}` });
  const lines = (): string[] => presentation().text.split("\n");
  const folded = (): boolean => lines().length > PASTE_COLLAPSE_LINES;

  const shown = (): string =>
    folded() && !open("text")
      ? lines().slice(0, PASTE_PREVIEW_LINES).join("\n")
      : presentation().text;

  const fileLabel = (file: PresentedFile, index: number): string =>
    ` File ${basename(file.path)}${
      file.text === undefined || open(`file:${String(index)}`)
        ? ""
        : ` +${String(lineCount(file.text))} lines`
    } `;

  const shellLabel = (run: PresentedShell, index: number): string =>
    ` Shell ${run.command}${run.exitCode === 0 ? "" : ` exit ${String(run.exitCode)}`}${
      open(`shell:${String(index)}`) ? "" : ` +${String(lineCount(run.output))} lines`
    } `;

  const hasTags = (): boolean => {
    const { files, skills, shells, images } = presentation();

    return files.length + skills.length + shells.length + images.length > 0;
  };

  return (
    <box
      id={`user:${props.message.id}`}
      flexDirection="column"
      width="100%"
      gap={1}
      backgroundColor={theme().userBackground}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={3}
      paddingRight={1}
    >
      <Show when={presentation().text !== ""}>
        <text
          fg={theme().foreground}
          wrapMode="word"
          selectionBg={theme().selectionBackground}
          selectionFg={theme().selectionForeground}
        >
          {shown()}
        </text>
      </Show>
      <Show when={folded()}>
        <box flexDirection="row">
          <Tag
            label={
              open("text")
                ? " fewer lines "
                : ` +${String(lines().length - PASTE_PREVIEW_LINES)} lines `
            }
            onClick={() => toggle("text")}
          />
        </box>
      </Show>
      <Show when={hasTags()}>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={presentation().skills}>
            {(skill) => (
              <Tag
                label={` Skill ${skill.name} `}
                onClick={() => app.dispatch({ kind: "open-external", target: skill.path })}
              />
            )}
          </For>
          <For each={presentation().files}>
            {(file, index) => (
              <Tag
                label={fileLabel(file, index())}
                onClick={() =>
                  file.text === undefined
                    ? app.dispatch({ kind: "open-external", target: file.path })
                    : toggle(`file:${String(index())}`)
                }
              />
            )}
          </For>
          <For each={presentation().shells}>
            {(run, index) => (
              <Tag
                label={shellLabel(run, index())}
                onClick={() => toggle(`shell:${String(index())}`)}
              />
            )}
          </For>
          <For each={presentation().images}>
            {(image, index) => (
              <Tag
                label={` Image ${String(index() + 1)} (${image.mime}) `}
                onClick={() => toggle(`image:${String(index())}`)}
              />
            )}
          </For>
        </box>
      </Show>
      <For each={presentation().files}>
        {(file, index) => (
          <Show when={file.text !== undefined && open(`file:${String(index())}`)}>
            <code
              content={file.text ?? ""}
              filetype={pathToFiletype(file.path)}
              syntaxStyle={app.kit.syntax().normal}
              fg={theme().foreground}
              selectionBg={theme().selectionBackground}
              selectionFg={theme().selectionForeground}
              width="100%"
            />
          </Show>
        )}
      </For>
      <For each={presentation().shells}>
        {(run, index) => (
          <Show when={open(`shell:${String(index())}`)}>
            <code
              content={run.output}
              syntaxStyle={app.kit.syntax().normal}
              fg={theme().foreground}
              selectionBg={theme().selectionBackground}
              selectionFg={theme().selectionForeground}
              width="100%"
            />
          </Show>
        )}
      </For>
      <For each={presentation().images}>
        {(image, index) => (
          <Show when={open(`image:${String(index())}`)}>
            <ImageBody image={image} />
          </Show>
        )}
      </For>
    </box>
  );
}
