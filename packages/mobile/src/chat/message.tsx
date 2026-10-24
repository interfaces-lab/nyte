import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { spacing, textStyles, tokens } from "../theme.ts";

export function Message({
  align = "start",
  children,
}: {
  align?: "start" | "end";
  children: ReactNode;
}) {
  return <html.div style={[styles.message, align === "end" && styles.end]}>{children}</html.div>;
}

export function MessageFooter({
  alert = false,
  children,
}: {
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <html.span
      role={alert ? "alert" : undefined}
      style={[textStyles.caption, alert && styles.alert]}
    >
      {children}
    </html.span>
  );
}

const styles = css.create({
  message: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingBlock: spacing.xs,
  },
  end: {
    alignItems: "flex-end",
  },
  alert: { color: tokens.danger, textAlign: "end" },
});
