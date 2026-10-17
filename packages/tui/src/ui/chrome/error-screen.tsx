import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { onMount } from "solid-js";
import type { CliTheme } from "../../lib/theme.ts";

export function ErrorScreen(props: {
  readonly theme: CliTheme;
  readonly error: unknown;
  readonly logPath: string;
  readonly reset: () => void;
  readonly quit: () => void;
}): JSX.Element {
  let root: BoxRenderable | undefined;

  const message = () =>
    props.error instanceof Error
      ? (props.error.stack ?? `${props.error.name}: ${props.error.message}`)
      : String(props.error);

  onMount(() => root?.focus());

  return (
    <box
      ref={(box) => (root = box)}
      id="error-screen"
      focusable
      width="100%"
      height="100%"
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      gap={1}
      backgroundColor={props.theme.backdrop}
      onKeyDown={(key) => {
        if (key.ctrl || key.meta || key.super) return;

        if (key.name === "r") {
          key.preventDefault();
          props.reset();
        }

        if (key.name === "q") {
          key.preventDefault();
          props.quit();
        }
      }}
    >
      <text fg={props.theme.error} flexShrink={0}>
        Something went wrong while drawing the screen.
      </text>
      <text fg={props.theme.foreground} flexShrink={1} minHeight={1}>
        {message()}
      </text>
      <text fg={props.theme.dim} flexShrink={0}>
        {`Details were written to ${props.logPath}`}
      </text>
      <text flexShrink={0} wrapMode="none">
        <span style={{ fg: props.theme.accent }}>r</span>
        <span style={{ fg: props.theme.dim }}> reset · </span>
        <span style={{ fg: props.theme.accent }}>q</span>
        <span style={{ fg: props.theme.dim }}> quit</span>
      </text>
    </box>
  );
}
