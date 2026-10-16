/**
 * Markdown as the transcript draws it: top-level blocks with the kit's
 * SyntaxStyle (normal or subtle), mermaid fences split out as their own
 * diagram blocks. Segments are keyed by position, so a streaming delta
 * updates one `<markdown>` in place instead of remounting it. A new
 * SyntaxStyle does remount it: OpenTUI restyles a list in place but skips
 * unchanged items, which would keep drawing with the destroyed old style.
 */
import type { SyntaxStyle } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, Index, Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { Mermaid } from "./mermaid.tsx";

export type Segment = MarkdownSegment | MermaidSegment;

export interface MarkdownSegment {
  readonly kind: "markdown";
  readonly text: string;
}

export interface MermaidSegment {
  readonly kind: "mermaid";
  readonly source: string;
}

function mermaidOf(segment: Segment): MermaidSegment | undefined {
  return segment.kind === "mermaid" ? segment : undefined;
}

function markdownOf(segment: Segment): MarkdownSegment | undefined {
  return segment.kind === "markdown" ? segment : undefined;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)/u;

export function splitMermaid(markdown: string): readonly Segment[] {
  const lines = markdown.split("\n");
  const segments: Segment[] = [];
  let text: string[] = [];
  let index = 0;

  const flush = (): void => {
    if (text.length === 0) return;
    segments.push({ kind: "markdown", text: text.join("\n") });
    text = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opened = FENCE.exec(line);

    if (opened === null) {
      text.push(line);
      index += 1;
      continue;
    }

    const marker = opened[1] ?? "```";

    const closes = (candidate: string): boolean => {
      const trimmed = candidate.trim();

      return (
        trimmed.length >= marker.length && trimmed.split("").every((char) => char === marker[0])
      );
    };

    let end = index + 1;

    while (end < lines.length && !closes(lines[end] ?? "")) end += 1;

    if (end >= lines.length) {
      text.push(...lines.slice(index));
      break;
    }

    if ((opened[2] ?? "").toLowerCase() === "mermaid") {
      flush();
      segments.push({ kind: "mermaid", source: lines.slice(index + 1, end).join("\n") });
    } else text.push(...lines.slice(index, end + 1));

    index = end + 1;
  }

  flush();

  return segments;
}

export function Markdown(props: {
  readonly id?: string;
  readonly messageId: string;
  readonly content: string;
  readonly streaming: boolean;
  readonly subtle: boolean;
}): JSX.Element {
  const { kit } = useApp();
  const segments = createMemo(() => splitMermaid(props.content));
  const syntaxStyle = (): SyntaxStyle => (props.subtle ? kit.syntax().subtle : kit.syntax().normal);

  return (
    <box id={props.id} flexDirection="column" width="100%" gap={1}>
      <Index each={segments()}>
        {(segment, index) => (
          <Switch>
            <Match when={mermaidOf(segment())}>
              {(diagram: Accessor<MermaidSegment>) => (
                <Mermaid
                  source={diagram().source}
                  disclosure={`${props.messageId}:mermaid:${String(index)}`}
                />
              )}
            </Match>
            <Match when={markdownOf(segment())}>
              {(block: Accessor<MarkdownSegment>) => (
                <Show when={syntaxStyle()} keyed>
                  {(style: SyntaxStyle) => (
                    <markdown
                      content={block().text}
                      syntaxStyle={style}
                      fg={props.subtle ? kit.theme().dim : kit.theme().foreground}
                      streaming={props.streaming && index === segments().length - 1}
                      internalBlockMode="top-level"
                      tableOptions={{ selectable: true, cellPaddingX: 1 }}
                    />
                  )}
                </Show>
              )}
            </Match>
          </Switch>
        )}
      </Index>
    </box>
  );
}
