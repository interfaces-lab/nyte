import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { DraftPart } from "../../model/draft.ts";

const MAX_PREVIEW_ROWS = 10;

function previewText(part: Exclude<DraftPart, { readonly kind: "image" }>): string {
  switch (part.kind) {
    case "paste":
    case "excerpt":
      return part.text;
    case "shell":
      return part.output;
    case "file":
      return part.body ?? part.path;
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

export function AttachmentPreview(props: {
  readonly marker: string;
  readonly part: DraftPart;
}): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const theme = () => app.kit.theme();
  const image = () => (props.part.kind === "image" ? props.part : null);
  const text = () => (props.part.kind === "image" ? null : previewText(props.part));
  const height = () => Math.max(1, Math.min(MAX_PREVIEW_ROWS, Math.floor(dimensions().height / 3)));

  return (
    <box
      id="attachment-preview"
      flexDirection="column"
      flexShrink={0}
      width="100%"
      paddingLeft={3}
      paddingRight={2}
    >
      <text
        fg={theme().dim}
        height={1}
        wrapMode="none"
        selectable={false}
        onMouseUp={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          app.dispatch({ kind: "close-preview" });
        }}
      >
        {`${props.marker} · click to close`}
      </text>
      <Show when={image()}>
        {(shown: Accessor<Extract<DraftPart, { readonly kind: "image" }>>) => (
          <image source={shown().bytes ?? undefined} width="100%" height={height()} fit="fit" />
        )}
      </Show>
      <Show when={text()}>
        {(content: Accessor<string>) => (
          <scrollbox width="100%" height={height()} scrollX scrollY>
            <code
              content={content()}
              syntaxStyle={app.kit.syntax().normal}
              fg={theme().foreground}
              wrapMode="word"
              selectionBg={theme().selectionBackground}
              selectionFg={theme().selectionForeground}
            />
          </scrollbox>
        )}
      </Show>
    </box>
  );
}
