import { intent } from "@nyte-ai/ui/surface-theme";
import { avatar, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuTrigger } from "@nyte-ai/ui/menu";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode, Ref } from "react";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";

const styles = create({
  row: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: `${avatar.md} minmax(0, 1fr) auto`,
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s2,
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
  body: { display: "flex", flexDirection: "column", minWidth: 0, gap: space.s0_5 },
  title: {
    color: role.contentPrimary,
    fontWeight: type.weightRegular,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: "currentColor" },
  control: {
    display: "inline-flex",
    justifyContent: "flex-end",
    "@container (max-width: 600px)": { gridColumn: "2 / -1" },
  },
  expansion: { gridColumn: "1 / -1", paddingTop: space.s1 },
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
        text.sm,
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
  expansion?: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.row)}>
      <span {...props(styles.glyph)}>{glyph}</span>
      <span {...props(styles.body)}>
        <span {...props(text.base, styles.title)}>{title}</span>
        {detail !== undefined && <span {...props(text.base, styles.detail)}>{detail}</span>}
      </span>
      {control !== undefined && <span {...props(styles.control)}>{control}</span>}
      {expansion !== undefined && <div {...props(styles.expansion)}>{expansion}</div>}
    </div>
  );
}
