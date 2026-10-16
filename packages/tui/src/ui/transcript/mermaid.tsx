import type { JSX } from "@opentui/solid";
import { renderMermaidASCII } from "beautiful-mermaid";
import { createMemo, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { displayWidth } from "../../lib/width.ts";
import { useTranscript } from "./scope.tsx";

interface Diagram {
  readonly text: string;
  readonly height: number;
  readonly width: number;
}

const MAX_VIEWPORT_ROWS = 24;

export function prepareDiagram(source: string): Diagram {
  if (source.length > 8_000 || source.split("\n").length > 120)
    throw new RangeError("Diagram is too large");
  const text = renderMermaidASCII(source, { colorMode: "none", paddingX: 3, paddingY: 2 });
  const lines = text.split("\n");

  if (lines.length > 300 || text.length > 100_000) throw new RangeError("Diagram is too large");

  return { text, height: lines.length, width: Math.max(1, ...lines.map(displayWidth)) };
}

export function Mermaid(props: {
  readonly source: string;
  readonly disclosure: string;
}): JSX.Element {
  const app = useApp();
  const scope = useTranscript();
  const theme = (): ReturnType<typeof app.kit.theme> => app.kit.theme();

  const diagram = createMemo<Diagram | null>((last) => {
    try {
      return prepareDiagram(props.source);
    } catch {
      return last;
    }
  }, null);

  const showingSource = (): boolean =>
    diagram() === null || scope.model().disclosures.has(props.disclosure);

  return (
    <box flexDirection="column" width="100%">
      <Show when={diagram()}>
        <text
          fg={theme().dim}
          selectable={false}
          wrapMode="none"
          height={1}
          onMouseUp={(event) => {
            if (event.button !== 0 || app.screen().selectionActive) return;
            event.preventDefault();
            event.stopPropagation();
            app.dispatch({ kind: "toggle-disclosure", key: props.disclosure });
          }}
        >
          {showingSource() ? "mermaid · click for diagram" : "mermaid · click for source"}
        </text>
      </Show>
      <Show
        when={showingSource() ? undefined : diagram()}
        fallback={
          <code
            content={props.source}
            syntaxStyle={app.kit.syntax().normal}
            conceal={false}
            fg={theme().foreground}
            bg={theme().codeBackground}
            selectionBg={theme().selectionBackground}
            selectionFg={theme().selectionForeground}
            width="100%"
          />
        }
      >
        {(prepared: Accessor<Diagram>) => (
          <scrollbox
            width="100%"
            height={Math.min(prepared().height + 1, MAX_VIEWPORT_ROWS)}
            scrollX
            scrollY
          >
            <text
              fg={theme().foreground}
              wrapMode="none"
              selectionBg={theme().selectionBackground}
              selectionFg={theme().selectionForeground}
            >
              {prepared().text}
            </text>
          </scrollbox>
        )}
      </Show>
    </box>
  );
}
