/**
 * The card of rows Settings uses for anything that connects: the GitHub
 * account and each model provider. A row says where it stands first, then
 * offers the actions that change that.
 */
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

const styles = stylex.create({
  row: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 12,
    rowGap: 8,
    minHeight: 61,
    padding: 12,
    "::after": {
      position: "absolute",
      insetInline: 12,
      insetBlockEnd: 0,
      height: 1,
      backgroundColor: t.strokeQuaternary,
      content: '""',
    },
    ":last-child::after": { display: "none" },
  },
  dimmed: { opacity: 0.55 },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: t.radiusBase,
    color: t.iconSecondary,
    overflow: "hidden",
  },
  body: { display: "flex", flexDirection: "column", minWidth: 0, gap: 1 },
  title: {
    color: t.textPrimary,
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    overflowWrap: "anywhere",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
  },
  statusOn: { color: t.textSuccess },
  statusWarn: { color: t.textWarning },
  statusErr: { color: t.textDanger },
  dot: { width: 6, height: 6, borderRadius: t.radiusFull, backgroundColor: "currentColor" },
  end: {
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
    "@container (max-width: 600px)": {
      gridColumn: "2 / -1",
      justifyContent: "flex-end",
      flexWrap: "wrap",
    },
  },
  actions: { display: "inline-flex", justifyContent: "flex-end", gap: 6, minWidth: 104 },
  expansion: { gridColumn: "1 / -1", paddingTop: 4 },
});

export type ConnectionTone = "on" | "off" | "warn" | "err";

export function ConnectionStatus({
  tone,
  children,
}: {
  tone: ConnectionTone;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      {...stylex.props(
        styles.status,
        tone === "on" && styles.statusOn,
        tone === "warn" && styles.statusWarn,
        tone === "err" && styles.statusErr,
      )}
    >
      <span aria-hidden="true" {...stylex.props(styles.dot)} />
      {children}
    </span>
  );
}

export function ConnectionList({ children }: { children: ReactNode }): ReactElement {
  return <div {...stylex.props(settingsPatterns.group)}>{children}</div>;
}

export function ConnectionRow({
  glyph,
  title,
  detail,
  status,
  actions,
  trailing,
  dimmed = false,
  expansion,
}: {
  glyph: ReactNode;
  title: string;
  detail: string | undefined;
  /** Where the connection stands. Rows that only carry detail leave it out. */
  status?: ReactElement;
  actions?: ReactNode;
  /** A control that stays live even when the row is dimmed, such as an on/off switch. */
  trailing?: ReactNode;
  dimmed?: boolean;
  /** Full-width content under the row, such as a form the actions opened. */
  expansion?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.glyph, dimmed && styles.dimmed)}>{glyph}</span>
      <span {...stylex.props(styles.body, dimmed && styles.dimmed)}>
        <span {...stylex.props(styles.title)}>{title}</span>
        {detail !== undefined && <span {...stylex.props(styles.detail)}>{detail}</span>}
      </span>
      {(status !== undefined || actions !== undefined || trailing !== undefined) && (
        <span {...stylex.props(styles.end)}>
          {status}
          {(actions !== undefined || trailing !== undefined) && (
            <span {...stylex.props(styles.actions)}>{actions}</span>
          )}
          {trailing}
        </span>
      )}
      {expansion !== undefined && <div {...stylex.props(styles.expansion)}>{expansion}</div>}
    </div>
  );
}
