import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { avatar, button, glyph, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import type { IconName } from "@nyte-ai/ui/icon";
import { MODEL_IDS, MODELS } from "./model.ts";
import type { Check, Item, ModelId, Moment, Person, Status, Surface } from "./model.ts";
import type { Progress, Tone } from "./progress.ts";

const NARROW = "@container stacks (max-width: 639px)";

const pulse = keyframes({
  "0%": {
    boxShadow: `0 0 0 0 color-mix(in oklab, ${role.contentInteractivePrimary} 45%, transparent)`,
  },
  "70%": {
    boxShadow: `0 0 0 4px color-mix(in oklab, ${role.contentInteractivePrimary} 0%, transparent)`,
  },
  "100%": {
    boxShadow: `0 0 0 0 color-mix(in oklab, ${role.contentInteractivePrimary} 0%, transparent)`,
  },
});

const TONES: Readonly<Record<Tone, { readonly tint: Tint; readonly icon: IconName }>> = {
  running: { tint: "blue", icon: "agent" },
  you: { tint: "yellow", icon: "bubble-question" },
  failed: { tint: "red", icon: "warning" },
  others: { tint: "teal", icon: "eye" },
  queued: { tint: "gray", icon: "clock" },
  merged: { tint: "purple", icon: "merged" },
  done: { tint: "green", icon: "checkmark" },
  stopped: { tint: "gray", icon: "square" },
};

const track = create({
  track: { display: "inline-flex", alignItems: "center", flexShrink: 0 },
  dot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: radius.pill,
    boxShadow: `inset 0 0 0 1px ${role.contentDisabled}`,
  },
  dotFilled: { backgroundColor: role.contentInteractivePrimary, boxShadow: "none" },
  dotLive: {
    animationName: { default: pulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
  },
  dotStopped: { backgroundColor: role.contentTertiary, boxShadow: "none" },
  link: { width: 6, height: 1, flexShrink: 0, backgroundColor: role.contentDisabled },
  linkDone: { backgroundColor: role.contentInteractivePrimary },
  label: { color: role.contentInteractivePrimary, whiteSpace: "nowrap" },
  labelQuiet: { color: role.contentSecondary, whiteSpace: "nowrap" },
  stepTile: { position: "relative" },
  live: {
    position: "absolute",
    insetBlockStart: -2,
    insetInlineEnd: -2,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: role.contentInteractivePrimary,
    boxShadow: `0 0 0 2px ${role.bgBase}`,
  },
});

function toneScope(tone: Tone): (typeof intent)[keyof typeof intent] {
  if (tone === "you") return intent.warning;

  if (tone === "failed") return intent.danger;

  if (tone === "merged") return surfaceTheme.purple;

  if (tone === "others") return surfaceTheme.teal;

  return intent.primary;
}

/**
 * Every step of the item's kind as a dot: green behind it, the one it's on in its tone, hollow
 * ahead. A finished item is green all the way; a stopped one keeps what it got through, grey.
 */
export function StepTrack({ progress }: { readonly progress: Progress }): ReactElement {
  const ended = progress.at >= progress.steps.length;

  const where = ended
    ? progress.label
    : `Step ${String(progress.at + 1)} of ${String(progress.steps.length)}, ${progress.steps[progress.at] ?? ""}`;

  return (
    <span role="img" aria-label={where} title={progress.steps.join(" → ")} {...props(track.track)}>
      {progress.steps.map((step, index) => {
        const behind = index < progress.at;
        const here = index === progress.at && progress.tone !== "queued";

        return (
          <span key={step} {...props(track.track)}>
            {index > 0 && (
              <span
                {...props(
                  behind && progress.tone !== "stopped" && intent.success,
                  track.link,
                  index <= progress.at && progress.tone !== "stopped" && track.linkDone,
                )}
              />
            )}
            <span
              {...props(
                behind ? intent.success : here && toneScope(progress.tone),
                track.dot,
                (behind || here) && track.dotFilled,
                behind && progress.tone === "stopped" && track.dotStopped,
                here && progress.tone === "running" && track.dotLive,
              )}
            />
          </span>
        );
      })}
    </span>
  );
}

/** The step's name in its tone, the way the row and the item page both say it. */
export function StepLabel({ progress }: { readonly progress: Progress }): ReactElement {
  const quiet =
    progress.tone === "queued" || progress.tone === "stopped" || progress.tone === "done";

  return (
    <span {...props(!quiet && toneScope(progress.tone), quiet ? track.labelQuiet : track.label)}>
      {progress.label}
    </span>
  );
}

/** A tile that says where the item is, with a dot while an agent runs on it. */
export function StepTile({
  progress,
  size = "sm",
}: {
  readonly progress: Progress;
  readonly size?: "xs" | "sm";
}): ReactElement {
  const tone = TONES[progress.tone];

  return (
    <span
      aria-hidden="true"
      {...props(
        surfaceTheme[tone.tint],
        styles.tile,
        size === "sm" ? styles.tileSm : styles.tileXs,
        track.stepTile,
      )}
    >
      <Icon name={tone.icon} size={size === "sm" ? 14 : 11} />
      {progress.tone === "running" && size === "sm" && (
        <span {...props(intent.primary, track.live, track.dotLive)} />
      )}
    </span>
  );
}

/** `#486`, or nothing before there's a pull request. */
export function itemNumber(item: Item): string | null {
  return item.number === null ? null : `#${String(item.number)}`;
}

export const styles = create({
  tile: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color: role.contentInteractivePrimary,
    backgroundColor: `color-mix(in oklab, ${role.contentInteractivePrimary} 13%, transparent)`,
  },
  tileSm: { width: avatar.sm, height: avatar.sm, borderRadius: 6 },
  tileXs: {
    display: "inline-grid",
    width: glyph.md,
    height: glyph.md,
    borderRadius: radius.indicator,
    verticalAlign: "-3px",
  },
  tileLg: { width: 44, height: 44, borderRadius: radius.card },
  glyph: {
    display: "grid",
    placeItems: "center",
    width: glyph.md,
    height: glyph.md,
    flexShrink: 0,
    color: role.contentSecondary,
  },
  /** A section's name: sentence case, the size of the text under it, a step quieter. */
  group: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    letterSpacing: type.letterBase,
    fontWeight: type.weightMedium,
  },
  count: {
    minWidth: glyph.md,
    paddingInline: space.s1,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMuted,
    color: role.contentSecondary,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
  },
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
