/**
 * The chrome every dialog shares (was PanelLayout): a padded column with a
 * bold accent title, an optional query line, the body, and the hint line.
 * Widths and row budgets come from the terminal size through Yoga, never
 * from a declared row count; typed text is the model's, drawn with a caret.
 */
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, keycap } from "../../lib/constants.ts";
import type { ChatCommand } from "../../lib/constants.ts";
import { truncateDisplay } from "../../lib/width.ts";

/** Margin and padding the panel spends across both sides. */
const CHROME_WIDTH = 5;

/** The body's width in cells: the terminal minus the panel's chrome. */
export function useBodyWidth(): () => number {
  const dimensions = useTerminalDimensions();

  return () => Math.max(1, dimensions().width - CHROME_WIDTH);
}

/** Rows a slot dialog may give its list: half the terminal less the chrome around it. */
export function useRowCap(): () => number {
  const dimensions = useTerminalDimensions();

  return () => Math.max(1, Math.floor(dimensions().height / 2) - 6);
}

/** Cut to `width` cells with an ellipsis when there is room for one. */
export function cut(text: string, width: number): string {
  return truncateDisplay(text, width, width <= 1 ? "" : GLYPHS.ellipsis);
}

/** `enter select`, `↑↓ move`: a keycap and what it does. */
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
  /** Screen dialogs fill the column; slot dialogs take their content height. */
  readonly fill?: boolean;
  readonly children: JSX.Element;
}): JSX.Element {
  const { kit } = useApp();

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
        wrapMode="word"
        selectable={false}
        flexShrink={0}
      >
        {props.title}
      </text>
      {props.children}
      <text fg={kit.theme().dim} wrapMode="none" height={1} selectable={false} flexShrink={0}>
        {props.hints}
      </text>
    </box>
  );
}

/**
 * The query line: the typed text with a caret, or the placeholder. `marker`
 * reserves the two prompt cells of a typed-answer row, lit while `active`.
 */
export function QueryLine(props: {
  readonly text: string;
  readonly placeholder: string;
  readonly marker?: boolean;
  readonly active?: boolean;
  readonly masked?: boolean;
  readonly trailing?: string;
  readonly onClick?: () => void;
}): JSX.Element {
  const { kit } = useApp();
  const active = () => props.active ?? true;
  const shown = () => (props.masked ? "•".repeat(Array.from(props.text).length) : props.text);

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
        <span
          style={{
            fg: props.marker && active() ? kit.theme().selectionForeground : kit.theme().foreground,
          }}
        >
          {shown()}
        </span>
        <Show when={active()}>
          <span style={{ attributes: TextAttributes.INVERSE }}> </span>
        </Show>
      </Show>
      <Show when={props.trailing}>
        {(trailing: Accessor<string>) => <span style={{ fg: kit.theme().dim }}>{trailing()}</span>}
      </Show>
    </text>
  );
}

/** A dim one-line note: loading, empty and failed states. */
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
