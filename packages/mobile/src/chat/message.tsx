import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { spacing, textStyles } from "../theme.ts";

export function Message({
  align = "start",
  children,
}: {
  align?: "start" | "end";
  children: ReactNode;
}) {
  return <html.div style={[styles.message, align === "end" && styles.end]}>{children}</html.div>;
}

export function MessageFooter({ children }: { children: ReactNode }) {
  return <html.span style={textStyles.caption}>{children}</html.span>;
}

const styles = css.create({
  message: { display: "flex", flexDirection: "column" },
  end: {
    alignItems: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingBlock: spacing.xs,
  },
});
