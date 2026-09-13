import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { spacing, textStyles } from "../theme.ts";

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <html.div style={styles.content}>
      <html.h2 style={textStyles.title}>{title}</html.h2>
      {description ? <html.p style={textStyles.secondary}>{description}</html.p> : null}
      {children}
    </html.div>
  );
}

const styles = css.create({
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingBlock: spacing.xl,
  },
});
