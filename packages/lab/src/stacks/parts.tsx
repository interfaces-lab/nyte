import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { avatar, button, glyph, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { MODEL_IDS, MODELS } from "./model.ts";
import type { Check, ModelId, Moment, Person, Status, Surface } from "./model.ts";

const NARROW = "@container stacks (max-width: 639px)";

export const styles = create({
  tile: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color: role.contentInteractivePrimary,
    backgroundColor: `color-mix(in oklab, ${role.contentInteractivePrimary} 13%, transparent)`,
  },
  tileSm: { width: avatar.sm, height: avatar.sm, borderRadius: 6 },
  tileLg: { width: 44, height: 44, borderRadius: radius.card },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: glyph.md,
    height: glyph.md,
    flexShrink: 0,
    color: role.contentSecondary,
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: role.contentTertiary,
    fontSize: 10,
    lineHeight: "16px",
    fontWeight: type.weightMedium,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  count: {
    minWidth: glyph.md,
    paddingInline: space.s1,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: 0,
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  metaIcon: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  properties: {
    display: "grid",
    gridTemplateColumns: "96px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s1,
    margin: 0,
  },
  propertyRow: { display: "contents" },
  propertyLabel: {
    color: role.contentSecondary,
    minHeight: row.heightMd,
    display: "flex",
    alignItems: "center",
  },
  propertyValue: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    minHeight: row.heightMd,
    margin: 0,
    color: role.contentPrimary,
  },
  pickerTrigger: {
    display: "inline-flex",
    whiteSpace: "nowrap",
    alignItems: "center",
    gap: space.s1_5,
    height: button.heightMd,
    marginInlineStart: `calc(-1 * ${space.s2})`,
    paddingInline: space.s2,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      ":focus-visible": role.bgHover,
      "[data-popup-open]": role.bgHover,
    },
    color: role.contentPrimary,
    fontFamily: "inherit",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
  },
  pickerChevron: { display: "inline-flex", color: role.contentTertiary },
  checkDots: { display: "inline-flex", alignItems: "center", gap: 2 },
  checkDot: { width: 6, height: 6, borderRadius: radius.pill },
  checkDone: { backgroundColor: role.contentInteractivePrimary },
  checkPending: { boxShadow: `inset 0 0 0 1px ${role.contentTertiary}` },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: 44,
    paddingInline: { default: space.s4, [NARROW]: space.s3 },
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
    flexShrink: 0,
  },
  crumbs: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flex: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  crumb: { display: "flex", alignItems: "center", gap: space.s1, minWidth: 0, flexShrink: 0 },
  crumbLast: { flexShrink: 1 },
  crumbLink: {
    paddingInline: space.s1_5,
    paddingBlock: space.s0_5,
    borderWidth: 0,
    borderRadius: radius.indicator,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  crumbHere: {
    paddingInline: space.s1_5,
    color: role.contentPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  crumbPassive: { color: role.contentSecondary },
  crumbSeparator: { display: "inline-flex", color: role.contentDisabled },
  person: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  /** A button label that stays for screen readers but leaves the glyph alone on a phone. */
  wideLabel: {
    position: { default: "static", [NARROW]: "absolute" },
    width: { default: "auto", [NARROW]: 1 },
    height: { default: "auto", [NARROW]: 1 },
    overflow: { default: "visible", [NARROW]: "hidden" },
    clipPath: { default: "none", [NARROW]: "inset(50%)" },
    whiteSpace: "nowrap",
  },
  crumbCollapsible: { display: { default: "flex", [NARROW]: "none" } },
});

export function Tile({
  surface,
  size,
}: {
  readonly surface: Surface;
  readonly size: "sm" | "lg";
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      {...props(
        surfaceTheme[surface.tint],
        styles.tile,
        size === "sm" ? styles.tileSm : styles.tileLg,
      )}
    >
      <Icon name={surface.icon} size={size === "sm" ? 14 : 22} />
    </span>
  );
}

export function StatusGlyph({ status }: { readonly status: Status }): ReactElement {
  return (
    <span {...props(styles.glyph)}>
      {status === "needs-you" && <StatusDot mark="waiting" />}
      {status === "working" && <StatusDot mark="working" />}
      {status === "watching" && <Icon name="eye" size={14} label="Watching" />}
      {status === "merged" && <Icon name="merged" size={14} label="Merged" />}
      {status === "done" && <Icon name="checkmark" size={14} label="Done" />}
    </span>
  );
}

/** How long before `clock` a tick was, as "now", "4 min ago" or "2 h ago" (short: "4m", "2h"). */
export function ago(moment: Moment, clock: number, short = false): string {
  const minutes = clock - moment;

  if (minutes <= 0) return "now";

  if (minutes < 60) return short ? `${String(minutes)}m` : `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);

  return short ? `${String(hours)}h` : `${String(hours)} h ago`;
}

export function GroupLabel({
  label,
  count,
}: {
  readonly label: string;
  readonly count: number;
}): ReactElement {
  return (
    <span {...props(styles.group)}>
      {label}
      <span {...props(styles.count)}>{count}</span>
    </span>
  );
}

export function Meta({
  icon,
  children,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span {...props(text.sm, styles.meta)}>
      <span {...props(styles.metaIcon)}>{icon}</span>
      {children}
    </span>
  );
}

export function checkSummary(checks: readonly Check[]): string {
  const failed = checks.filter((check) => check.outcome === "failed").length;
  const passed = checks.filter((check) => check.outcome === "passed").length;

  if (failed > 0) return `${String(failed)} failed`;

  return `${String(passed)}/${String(checks.length)}`;
}

export function CheckDots({ checks }: { readonly checks: readonly Check[] }): ReactElement {
  return (
    <span aria-label={`Checks ${checkSummary(checks)}`} role="img" {...props(styles.checkDots)}>
      {checks.map((check) => (
        <span
          key={check.name}
          {...props(
            check.outcome === "failed"
              ? intent.danger
              : check.outcome === "passed" && intent.success,
            styles.checkDot,
            check.outcome !== "pending" && styles.checkDone,
            check.outcome === "pending" && styles.checkPending,
          )}
        />
      ))}
    </span>
  );
}

export function Properties({
  rows,
}: {
  readonly rows: readonly { readonly label: string; readonly value: ReactNode }[];
}): ReactElement {
  return (
    <dl {...props(text.base, styles.properties)}>
      {rows.map((row) => (
        <div key={row.label} {...props(styles.propertyRow)}>
          <dt {...props(styles.propertyLabel)}>{row.label}</dt>
          <dd {...props(styles.propertyValue)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ModelLabel({ model }: { readonly model: ModelId }): ReactElement {
  return (
    <>
      <Icon name={MODELS[model].icon} size={14} />
      {MODELS[model].name}
    </>
  );
}

export function ModelPicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: ModelId;
  readonly onChange: (model: ModelId) => void;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${label}: ${MODELS[value].name}`}
        {...props(text.base, styles.pickerTrigger)}
      >
        <ModelLabel model={value} />
        <span {...props(styles.pickerChevron)}>
          <Icon name="chevron-up-down" size={12} />
        </span>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const model = MODEL_IDS.find((id) => id === next);

            if (model !== undefined) onChange(model);
          }}
        >
          {MODEL_IDS.map((id) => (
            <MenuRadioItem key={id} value={id} icon={MODELS[id].icon} meta={MODELS[id].note}>
              {MODELS[id].name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export function PersonLabel({ person }: { readonly person: Person }): ReactElement {
  return (
    <span {...props(styles.person)}>
      <Avatar size="xs" tone={person.tone}>
        <AvatarFallback>{person.initials}</AvatarFallback>
      </Avatar>
      {person.name}
    </span>
  );
}

export function Header({
  trail,
  actions,
}: {
  readonly trail: readonly { readonly label: string; readonly onClick?: () => void }[];
  readonly actions?: ReactNode;
}): ReactElement {
  return (
    <header {...props(styles.header)}>
      <nav aria-label="Breadcrumb" {...props(styles.crumbs)}>
        {trail.map((crumb, index) => (
          <span
            key={crumb.label}
            {...props(
              text.base,
              styles.crumb,
              index === trail.length - 1 && styles.crumbLast,
              index === 0 && trail.length > 2 && styles.crumbCollapsible,
            )}
          >
            {index > 0 && (
              <span
                aria-hidden="true"
                {...props(
                  styles.crumbSeparator,
                  index === 1 && trail.length > 2 && styles.crumbCollapsible,
                )}
              >
                <Icon name="chevron-right" size={12} />
              </span>
            )}
            {crumb.onClick === undefined ? (
              <span
                aria-current={index === trail.length - 1 ? "page" : undefined}
                {...props(styles.crumbHere, index < trail.length - 1 && styles.crumbPassive)}
              >
                {crumb.label}
              </span>
            ) : (
              <button type="button" onClick={crumb.onClick} {...props(text.base, styles.crumbLink)}>
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>
      {actions}
    </header>
  );
}
