import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { controls, list, radii, spacing, tokens } from "../theme.ts";

/** A rounded surface card holding rows; hairline separators inset to content. */
export function Group({ children }: { children: ReactNode }) {
  return <html.div style={styles.group}>{children}</html.div>;
}

export function GroupRow({
  children,
  last = false,
  onClick,
  disabled = false,
  align = "start",
}: {
  children: ReactNode;
  last?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  align?: "start" | "center";
}) {
  const style = [
    styles.row,
    align === "center" && styles.centered,
    disabled && styles.disabled,
    !last && styles.separator,
  ];
  if (onClick !== undefined) {
    return (
      <html.button onClick={onClick} disabled={disabled} aria-disabled={disabled} style={style}>
        {children}
      </html.button>
    );
  }
  return <html.div style={style}>{children}</html.div>;
}

const styles = css.create({
  group: {
    marginInline: list.gutter,
    backgroundColor: tokens.surface,
    borderRadius: radii.card,
    borderWidth: controls.hairline,
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
    overflow: "hidden",
  },
  row: {
    minHeight: controls.touchTarget,
    paddingInline: spacing.md,
    paddingBlock: 10,
    gap: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  centered: { justifyContent: "center" },
  disabled: { opacity: controls.disabledOpacity },
  separator: {
    borderBottomWidth: controls.hairline,
    borderBottomColor: tokens.separator,
    // Inset the separator to the content column.
    marginInlineStart: list.tile + spacing.md,
  },
});
