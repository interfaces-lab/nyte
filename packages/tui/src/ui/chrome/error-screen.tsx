/** The root boundary's fallback: fixed colours, the error, the crash log path; R resets, Q quits. */
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { onMount } from "solid-js";

/** Not the theme: the theme may be what failed. */
const PALETTE = {
  background: "#171717",
  foreground: "#e5e5e5",
  error: "#f87171",
  dim: "#a3a3a3",
  key: "#93c5fd",
} as const;

export function ErrorScreen(props: {
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
      backgroundColor={PALETTE.background}
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
      <text fg={PALETTE.error} flexShrink={0}>
        Something went wrong while drawing the screen.
      </text>
      <text fg={PALETTE.foreground} flexShrink={1} minHeight={1}>
        {message()}
      </text>
      <text fg={PALETTE.dim} flexShrink={0}>
        {`Details were written to ${props.logPath}`}
      </text>
      <text flexShrink={0} wrapMode="none">
        <span style={{ fg: PALETTE.key }}>r</span>
        <span style={{ fg: PALETTE.dim }}> reset · </span>
        <span style={{ fg: PALETTE.key }}>q</span>
        <span style={{ fg: PALETTE.dim }}> quit</span>
      </text>
    </box>
  );
}
