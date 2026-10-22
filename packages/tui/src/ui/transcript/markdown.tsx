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
import { linkFilePaths } from "../../lib/file-links.ts";
import { Mermaid } from "./mermaid.tsx";

type Segment = MarkdownSegment | MermaidSegment;

interface MarkdownSegment {
  readonly kind: "markdown";
  readonly text: string;
}

interface MermaidSegment {
  readonly kind: "mermaid";
  readonly source: string;
}

function pickMermaid(segment: Segment): MermaidSegment | undefined {
  return segment.kind === "mermaid" ? segment : undefined;
}

function pickMarkdown(segment: Segment): MarkdownSegment | undefined {
  return segment.kind === "markdown" ? segment : undefined;
}

function readFence(line: string): { readonly marker: string; readonly mermaid: boolean } | null {
  const prefix = line.slice(0, 4);
  const start = prefix.length - prefix.trimStart().length;
  const marker = line[start];

  if (
    start > 3 ||
    (marker !== "`" && marker !== "~") ||
    line[start + 1] !== marker ||
    line[start + 2] !== marker
  )
    return null;

  let end = start + 3;

  while (line[end] === marker) end += 1;
  const info = line.slice(end).trimStart();

  return {
    marker: line.slice(start, end),
    mermaid: info.slice(0, 7).toLowerCase() === "mermaid" && info.charAt(7).trim() === "",
  };
}

export function createMermaidSplitter(): (markdown: string) => readonly Segment[] {
  let previous = "";
  let searchFrom = 0;
  let lineStart = 0;
  let textStart = 0;

  let opened: {
    readonly fence: NonNullable<ReturnType<typeof readFence>>;
    readonly start: number;
    readonly sourceStart: number;
  } | null = null;

  let completed: Segment[] = [];
  let result: readonly Segment[] = [{ kind: "markdown", text: "" }];

  return (markdown) => {
    if (markdown === previous) return result;

    if (!markdown.startsWith(previous)) {
      searchFrom = 0;
      lineStart = 0;
      textStart = 0;
      opened = null;
      completed = [];
    }

    const visit = (start: number, end: number, next: number): void => {
      const line = markdown.slice(start, end);

      if (opened === null) {
        const fence = readFence(line);

        if (fence !== null) opened = { fence, start, sourceStart: next };

        return;
      }

      const closing = line.trim();
      const { marker, mermaid } = opened.fence;

      if (closing.length < marker.length) return;

      for (let at = 0; at < closing.length; at += 1) if (closing[at] !== marker[0]) return;

      if (mermaid) {
        if (opened.start > textStart)
          completed.push({
            kind: "markdown",
            text: structuredClone(markdown.slice(textStart, opened.start - 1)),
          });
        completed.push({
          kind: "mermaid",
          source: structuredClone(markdown.slice(opened.sourceStart, start - 1)),
        });
        textStart = next;
      }

      opened = null;
    };

    for (
      let end = markdown.indexOf("\n", searchFrom);
      end !== -1;
      end = markdown.indexOf("\n", lineStart)
    ) {
      visit(lineStart, end, end + 1);
      lineStart = end + 1;
    }

    searchFrom = markdown.length;
    const stableLength = completed.length;
    const stableOpened = opened;
    const stableTextStart = textStart;

    if (lineStart < markdown.length) visit(lineStart, markdown.length, markdown.length + 1);
    const next = completed.slice();

    if (textStart <= markdown.length)
      next.push({ kind: "markdown", text: markdown.slice(textStart) });
    completed.length = stableLength;
    opened = stableOpened;
    textStart = stableTextStart;
    previous = markdown;
    result = next;

    return result;
  };
}

export function Markdown(props: {
  readonly id?: string;
  readonly messageId: string;
  readonly content: string;
  readonly streaming: boolean;
  readonly subtle: boolean;
}): JSX.Element {
  const { kit, screen } = useApp();
  const fileRoot = createMemo(() => screen().fileRoot);
  const splitMermaid = createMermaidSplitter();
  const segments = createMemo(() => splitMermaid(props.content));
  const syntaxStyle = (): SyntaxStyle => (props.subtle ? kit.syntax().subtle : kit.syntax().normal);

  return (
    <box id={props.id} flexDirection="column" width="100%" gap={1}>
      <Index each={segments()}>
        {(segment, index) => (
          <Switch>
            <Match when={pickMermaid(segment())}>
              {(diagram: Accessor<MermaidSegment>) => (
                <Mermaid
                  source={diagram().source}
                  disclosure={`${props.messageId}:mermaid:${String(index)}`}
                />
              )}
            </Match>
            <Match when={pickMarkdown(segment())}>
              {(block: Accessor<MarkdownSegment>) => {
                const content = createMemo(() => {
                  const root = fileRoot();

                  return root === null ? block().text : linkFilePaths(block().text, root);
                });

                return (
                  <Show when={syntaxStyle()} keyed>
                    {(style: SyntaxStyle) => (
                      <markdown
                        content={content()}
                        syntaxStyle={style}
                        fg={props.subtle ? kit.theme().dim : kit.theme().foreground}
                        streaming={props.streaming && index === segments().length - 1}
                        internalBlockMode="top-level"
                        tableOptions={{ selectable: true, cellPaddingX: 1 }}
                      />
                    )}
                  </Show>
                );
              }}
            </Match>
          </Switch>
        )}
      </Index>
    </box>
  );
}
