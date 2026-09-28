import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { conversation, radii, spacing, tokens } from "../theme.ts";

type BubbleProps = { children: ReactNode } & (
  | { variant?: "default"; maxWidth: number }
  | { variant: "ghost" }
);

export function Bubble(props: BubbleProps) {
  return (
    <html.div
      style={[
        styles.bubble,
        props.variant === "ghost"
          ? styles.ghost
          : [styles.default, styles.maxWidth(props.maxWidth)],
      ]}
    >
      {props.children}
    </html.div>
  );
}

const styles = css.create({
  bubble: { display: "flex", flexDirection: "column" },
  default: {
    backgroundColor: tokens.raised,
    borderRadius: radii.bubble,
    paddingInline: 14,
    paddingBlock: 10,
    gap: spacing.sm,
  },
  maxWidth: (maxWidth: number) => ({ maxWidth }),
  ghost: { paddingInline: conversation.textInset, paddingBlock: 6 },
});
