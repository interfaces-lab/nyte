import { intent } from "@nyte-ai/ui/surface-theme";
import { avatar, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuTrigger } from "@nyte-ai/ui/menu";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement, ReactNode, Ref } from "react";
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
  fact: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
    flex: "1 1 0",
  },
  factGlyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: avatar.md,
    height: avatar.md,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  },
  factGlyphOn: {
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentInteractivePrimary,
  },
  factActions: {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    flex: "none",
  },
});

const ROW_MARK = { "data-settings-row": "" } as const;

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
  finalFocus,
  children,
}: ConnectionStanding & {
  readonly label: string;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly finalFocus?: ComponentProps<typeof MenuContent>["finalFocus"];
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button ref={ref} loading={loading} disabled={disabled}>
            <span {...props(srOnly)}>{label}: </span>
            <ConnectionStatus tone={tone}>{status}</ConnectionStatus>
            <Icon name="chevron-down" size="xs" />
          </Button>
        }
      />
      <MenuContent align="end" finalFocus={finalFocus}>
        {children}
      </MenuContent>
    </Menu>
  );
}

/** A settings row for one fact: a round glyph, a title over its detail, and actions at the end. */
export function FactRow({
  icon,
  tone = "neutral",
  title,
  detail,
  children,
}: {
  readonly icon: IconName;
  readonly tone?: "neutral" | "on";
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div {...ROW_MARK} {...props(settingsPatterns.rowRule, settingsPatterns.row)}>
      <span {...props(styles.fact)}>
        <span
          {...props(
            tone === "on" && intent.primary,
            styles.factGlyph,
            tone === "on" && styles.factGlyphOn,
          )}
        >
          <Icon name={icon} size="md" />
        </span>
        <span {...props(settingsPatterns.rowCopy)}>
          <span {...props(settingsPatterns.rowTitle)}>{title}</span>
          {detail !== undefined && (
            <span {...props(settingsPatterns.rowDescription)}>{detail}</span>
          )}
        </span>
      </span>
      {children !== undefined && <span {...props(styles.factActions)}>{children}</span>}
    </div>
  );
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
