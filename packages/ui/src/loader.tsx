import { create, keyframes, props } from "@stylexjs/stylex";
import type { CSSProperties, ReactElement } from "react";

import { glyph } from "./styles/schema.stylex.ts";
import { mergeStyleProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";

const TURN_MS = 800;

const turn = keyframes({ from: { rotate: "0deg" }, to: { rotate: "360deg" } });

const styles = create({
  root: {
    display: "block",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    color: "inherit",
    animationName: { default: turn, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: `${TURN_MS}ms`,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  track: { opacity: 0.25 },
});

export interface LoaderProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"Loader">;
}

/**
 * Something that isn't AI work is loading: a page, an account, a download, a process. A
 * running chat, turn, subagent or tool call shows `Spinner` instead.
 */
export function Loader({ className, style, xstyle }: LoaderProps = {}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      {...mergeStyleProps(props(styles.root, xstyle), className, style)}
    >
      <circle cx={8} cy={8} r={6.25} {...props(styles.track)} />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" strokeLinecap="round" />
    </svg>
  );
}
