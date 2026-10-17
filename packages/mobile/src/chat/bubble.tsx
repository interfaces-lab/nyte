import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { radii, spacing, tokens } from "../theme.ts";

export function Bubble({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "incoming" | "outgoing";
}) {
  return (
    <html.div style={[styles.bubble, variant === "outgoing" ? styles.outgoing : styles.incoming]}>
      {children}
    </html.div>
  );
}

const styles = css.create({
  bubble: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radii.bubble,
    paddingInline: 14,
    paddingBlock: 10,
    gap: spacing.sm,
  },
  outgoing: { backgroundColor: tokens.outgoingBubble, borderBottomRightRadius: 7 },
  incoming: { backgroundColor: tokens.incomingBubble, borderBottomLeftRadius: 7 },
});
