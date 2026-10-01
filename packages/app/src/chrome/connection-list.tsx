import { intent } from "@nyte-ai/ui/surface-theme";
import { avatar, shape } from "@nyte-ai/ui/schema.stylex";
/**
 * The card of rows Settings uses for anything that connects: the GitHub
 * account and each model provider. A row says where it stands first, then
 * offers the actions that change that.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

const styles = create({
  row: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: `${avatar.md} minmax(0, 1fr) auto`,
    alignItems: "center",
    columnGap: 12,
    rowGap: 8,
    minHeight: settings.rowMinHeight,
    padding: settings.rowPadding,
    "::after": {
      position: "absolute",
      insetInline: settings.rowPadding,
      insetBlockEnd: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
    ":last-child::after": { display: "none" },
  },
  dimmedGlyph: { color: role.contentTertiary },
  dimmedText: { color: role.contentTertiary },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: avatar.md,
    height: avatar.md,
    borderRadius: shape.control,
    color: role.contentSecondary,
    overflow: "hidden",
  },
  body: { display: "flex", flexDirection: "column", minWidth: 0, gap: 1 },
  title: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 400,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
  dot: { width: 6, height: 6, borderRadius: shape.pill, backgroundColor: "currentColor" },
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
  actions: {
    display: "inline-flex",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
    minWidth: 104,
  },
  expansion: { gridColumn: "1 / -1", paddingTop: 4 },
});

type ConnectionTone = "on" | "off" | "warn" | "err";

export function ConnectionStatus({
  tone,
  children,
}: {
  tone: ConnectionTone;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      {...props(
        tone === "on" && intent.success,
        tone === "warn" && intent.warning,
        tone === "err" && intent.danger,
        styles.status,
      )}
    >
      <span aria-hidden="true" {...props(styles.dot)} />
      {children}
    </span>
  );
}

export function ConnectionList({ children }: { children: ReactNode }): ReactElement {
  return <div {...props(settingsPatterns.group)}>{children}</div>;
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
  title: ReactNode;
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
    <div {...props(styles.row)}>
      <span {...props(styles.glyph, dimmed && styles.dimmedGlyph)}>{glyph}</span>
      <span {...props(styles.body)}>
        <span {...props(styles.title, dimmed && styles.dimmedText)}>{title}</span>
        {detail !== undefined && (
          <span {...props(styles.detail, dimmed && styles.dimmedText)}>{detail}</span>
        )}
      </span>
      {(status !== undefined || actions !== undefined || trailing !== undefined) && (
        <span {...props(styles.end)}>
          {status}
          {(actions !== undefined || trailing !== undefined) && (
            <span {...props(styles.actions)}>{actions}</span>
          )}
          {trailing}
        </span>
      )}
      {expansion !== undefined && <div {...props(styles.expansion)}>{expansion}</div>}
    </div>
  );
}
