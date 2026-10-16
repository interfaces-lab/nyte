import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, keycap } from "../../lib/constants.ts";
import type { ChatCommand } from "../../lib/constants.ts";
import { displayWidth, truncateDisplay } from "../../lib/width.ts";

const CHROME_WIDTH = 5;

export function useBodyWidth(): () => number {
  const dimensions = useTerminalDimensions();

  return () => Math.max(1, dimensions().width - CHROME_WIDTH);
}

export function useRowCap(): () => number {
  const dimensions = useTerminalDimensions();

  return () => Math.max(1, Math.floor(dimensions().height / 2) - 6);
}

export function cut(text: string, width: number): string {
  return truncateDisplay(text, width, width <= 1 ? "" : GLYPHS.ellipsis);
}

export function hint(command: ChatCommand, label: string, style?: "symbol"): string {
  return `${keycap(command, style)} ${label}`;
}

export function moveHint(): string {
  return `${keycap("picker.previous", "symbol")}${keycap("picker.next", "symbol")} move`;
}

export function joinHints(hints: readonly string[]): string {
  return hints.join(" · ");
}

export function Panel(props: {
  readonly title: string;
  readonly hints: string;
  readonly fill?: boolean;
  readonly children: JSX.Element;
}): JSX.Element {
  const { kit } = useApp();
  const width = useBodyWidth();

  return (
    <box
      flexDirection="column"
      flexGrow={props.fill ? 1 : 0}
      flexShrink={props.fill ? 1 : 0}
      minHeight={0}
      overflow="hidden"
      marginLeft={1}
      marginRight={1}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text
        fg={kit.theme().accent}
        attributes={TextAttributes.BOLD}
        height={1}
        wrapMode="none"
        selectable={false}
        flexShrink={0}
      >
        {cut(props.title, width())}
      </text>
      {props.children}
      <text fg={kit.theme().dim} wrapMode="none" height={1} selectable={false} flexShrink={0}>
        {props.hints}
      </text>
    </box>
  );
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function QueryLine(props: {
  readonly text: string;
  readonly caret?: number;
  readonly anchor?: number;
  readonly placeholder: string;
  readonly marker?: boolean;
  readonly active?: boolean;
  readonly masked?: boolean;
  readonly trailing?: string;
  readonly onClick?: () => void;
}): JSX.Element {
  const { kit } = useApp();
  const active = () => props.active ?? true;
  const width = useBodyWidth();

  const mask = (text: string): string =>
    props.masked ? "•".repeat([...GRAPHEMES.segment(text)].length) : text;

  const viewport = createMemo(() => {
    const caret = Math.max(0, Math.min(props.caret ?? props.text.length, props.text.length));

    const segments = [...GRAPHEMES.segment(props.text)].map((segment) => ({
      index: segment.index,
      cells: props.masked ? 1 : displayWidth(segment.segment),
    }));

    const found = segments.findIndex((segment) => segment.index >= caret);
    const cursor = found === -1 ? segments.length : found;

    const available = Math.max(
      1,
      width() - (props.marker ? 2 : 0) - displayWidth(props.trailing ?? ""),
    );

    let start = active() ? cursor : 0;
    let used = active() ? Math.max(1, segments[cursor]?.cells ?? 1) : 0;

    while (start > 0) {
      const previous = segments[start - 1];

      if (previous === undefined || used + previous.cells > available) break;
      start -= 1;
      used += previous.cells;
    }

    let end = start;
    let cells = 0;

    while (end < segments.length) {
      const next = segments[end];

      if (next === undefined || cells + next.cells > available) break;
      cells += next.cells;
      end += 1;
    }

    return {
      from: segments[start]?.index ?? props.text.length,
      to: segments[end]?.index ?? props.text.length,
    };
  });

  const parts = createMemo(() => {
    const caret = Math.max(0, Math.min(props.caret ?? props.text.length, props.text.length));
    const rest = props.text.slice(caret, viewport().to);
    const under = GRAPHEMES.segment(rest)[Symbol.iterator]().next().value?.segment ?? "";

    return {
      before: mask(props.text.slice(viewport().from, caret)),
      under: under === "" ? " " : mask(under),
      after: mask(rest.slice(under.length)),
    };
  });

  const selection = createMemo(() => {
    const caret = Math.max(0, Math.min(props.caret ?? props.text.length, props.text.length));
    const anchor = Math.max(0, Math.min(props.anchor ?? caret, props.text.length));

    if (caret === anchor) return null;
    const from = Math.max(viewport().from, Math.min(caret, anchor));
    const to = Math.min(viewport().to, Math.max(caret, anchor));

    return {
      before: mask(props.text.slice(viewport().from, from)),
      selected: mask(props.text.slice(from, to)),
      after: mask(props.text.slice(to, viewport().to)),
    };
  });

  return (
    <text
      height={1}
      width="100%"
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      bg={props.marker && active() ? kit.theme().selectionBackground : undefined}
      onMouseDown={(event) => {
        if (event.button !== 0 || props.onClick === undefined) return;
        event.preventDefault();
        props.onClick();
      }}
    >
      <Show when={props.marker}>
        <span style={{ fg: kit.theme().selectionForeground }}>
          {active() ? `${GLYPHS.prompt} ` : "  "}
        </span>
      </Show>
      <Show
        when={props.text !== ""}
        fallback={
          <>
            <Show when={active()}>
              <span style={{ attributes: TextAttributes.INVERSE }}> </span>
            </Show>
            <span style={{ fg: kit.theme().muted }}>{props.placeholder}</span>
          </>
        }
      >
        <Show
          when={active()}
          fallback={
            <span style={{ fg: kit.theme().foreground }}>
              {mask(props.text.slice(viewport().from, viewport().to))}
            </span>
          }
        >
          <Show
            when={selection()}
            fallback={
              <>
                <span
                  style={{
                    fg: props.marker ? kit.theme().selectionForeground : kit.theme().foreground,
                  }}
                >
                  {parts().before}
                </span>
                <span style={{ attributes: TextAttributes.INVERSE }}>{parts().under}</span>
                <span
                  style={{
                    fg: props.marker ? kit.theme().selectionForeground : kit.theme().foreground,
                  }}
                >
                  {parts().after}
                </span>
              </>
            }
          >
            {(range: Accessor<NonNullable<ReturnType<typeof selection>>>) => (
              <>
                <span
                  style={{
                    fg: props.marker ? kit.theme().selectionForeground : kit.theme().foreground,
                  }}
                >
                  {range().before}
                </span>
                <span
                  style={{
                    fg: kit.theme().selectionForeground,
                    bg: kit.theme().selectionBackground,
                  }}
                >
                  {range().selected}
                </span>
                <span
                  style={{
                    fg: props.marker ? kit.theme().selectionForeground : kit.theme().foreground,
                  }}
                >
                  {range().after}
                </span>
              </>
            )}
          </Show>
        </Show>
      </Show>
      <Show when={props.trailing}>
        {(trailing: Accessor<string>) => <span style={{ fg: kit.theme().dim }}>{trailing()}</span>}
      </Show>
    </text>
  );
}

export function Note(props: {
  readonly text: string;
  readonly tone?: "dim" | "error";
}): JSX.Element {
  const { kit } = useApp();

  return (
    <text
      height={1}
      wrapMode="none"
      selectable={false}
      flexShrink={0}
      fg={props.tone === "error" ? kit.theme().error : kit.theme().dim}
    >
      {props.text}
    </text>
  );
}
