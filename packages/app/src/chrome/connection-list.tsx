import { intent } from "@nyte-ai/ui/surface-theme";
import { avatar, radius } from "@nyte-ai/ui/schema.stylex";
/**
 * The card of rows Settings uses for anything that connects: the GitHub
 * account and each model provider. A row ends in one control: a button for
 * what is not set up yet, or a status menu that holds the verbs.
 */
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuTrigger } from "@nyte-ai/ui/menu";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode, Ref } from "react";
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
    padding: settings.rowPadding,
    "::after": {
      position: "absolute",
      insetInline: settings.rowPaddingInline,
      insetBlockEnd: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
    ":last-child::after": { display: "none" },
  },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: avatar.md,
    height: avatar.md,
    borderRadius: radius.control,
    color: role.contentSecondary,
    overflow: "clip",
  },
  body: { display: "flex", flexDirection: "column", minWidth: 0, gap: 2 },
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
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: "currentColor" },
  control: {
    display: "inline-flex",
    justifyContent: "flex-end",
    "@container (max-width: 600px)": { gridColumn: "2 / -1" },
  },
  expansion: { gridColumn: "1 / -1", paddingTop: 4 },
});

type ConnectionTone = "on" | "off" | "warn" | "err";

export interface ConnectionStanding {
  readonly tone: ConnectionTone;
  readonly status: string;
}

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

export function ConnectionMenu({
  label,
  tone,
  status,
  loading = false,
  disabled = false,
  ref,
  children,
}: ConnectionStanding & {
  readonly label: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button ref={ref} loading={loading} disabled={disabled}>
            <span {...props(srOnly)}>{label}: </span>
            <ConnectionStatus tone={tone}>{status}</ConnectionStatus>
            <Icon name="chevron-down" size={12} />
          </Button>
        }
      />
      <MenuContent align="end">{children}</MenuContent>
    </Menu>
  );
}

export function ConnectionList({ children }: { children: ReactNode }): ReactElement {
  return <div {...props(settingsPatterns.group)}>{children}</div>;
}

export function ConnectionRow({
  glyph,
  title,
  detail,
  control,
  expansion,
}: {
  glyph: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  control?: ReactNode;
  /** Full-width content under the row, such as a form the control opened. */
  expansion?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.row)}>
      <span {...props(styles.glyph)}>{glyph}</span>
      <span {...props(styles.body)}>
        <span {...props(styles.title)}>{title}</span>
        {detail !== undefined && <span {...props(styles.detail)}>{detail}</span>}
      </span>
      {control !== undefined && <span {...props(styles.control)}>{control}</span>}
      {expansion !== undefined && <div {...props(styles.expansion)}>{expansion}</div>}
    </div>
  );
}
