/**
 * One specimen per foundation page, drawn from the live tokens: every colour,
 * corner, gap, and curve here resolves through the same StyleX variables the
 * components read, in the current scheme.
 */

import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { appearance, motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { surfaceTheme, type Tint } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { declaredToken } from "~/lib/design-tokens";

const tints = Object.keys(surfaceTheme).filter((tint): tint is Tint => tint in surfaceTheme);

function ColorsSpecimen() {
  return (
    <div {...props(styles.swatches)}>
      {tints.map((tint) => (
        <div key={tint} {...props(surfaceTheme[tint], styles.swatch)}>
          <span {...props(styles.swatchFill)} />
          <span {...props(styles.swatchTint)} />
          <code {...props(styles.swatchName)}>{tint}</code>
        </div>
      ))}
    </div>
  );
}

const corners = [radius.indicator, radius.control, radius.card, radius.surface, radius.pill];

function RadiusSpecimen() {
  return (
    <div {...props(styles.corners)}>
      {corners.map((corner) => (
        <span key={corner} {...props(styles.corner(corner))} />
      ))}
    </div>
  );
}

const steps = [
  ["s1", space.s1],
  ["s2", space.s2],
  ["s3", space.s3],
  ["s4", space.s4],
  ["s6", space.s6],
  ["s8", space.s8],
] as const;

function SpacingSpecimen() {
  const unit = Number.parseFloat(declaredToken("--nyte-space-unit").value);

  return (
    <div {...props(styles.steps)}>
      {steps.map(([name, value]) => (
        <div key={name} {...props(styles.step)}>
          <code {...props(styles.stepName)}>{Number(name.slice(1)) * unit}</code>
          <span {...props(styles.stepBar(value))} />
        </div>
      ))}
    </div>
  );
}

const textStyles = [
  { name: "lg", style: text.lg },
  { name: "base", style: text.base },
  { name: "sm", style: text.sm },
  { name: "xs", style: text.xs },
] as const;

function TypographySpecimen() {
  return (
    <div {...props(styles.type)}>
      <span {...props(styles.glyphs)}>Aa</span>
      <div {...props(styles.typeLines)}>
        {textStyles.map((item) => (
          <div key={item.name} {...props(styles.typeLine)}>
            <code {...props(styles.typeName)}>{item.name}</code>
            <span {...props(item.style, styles.typeSample)}>Every session is a tree</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const elevations = [shadow.shadowSm, shadow.shadowMdOutline, shadow.shadowLg, shadow.shadowXl];

/** Each step lifts a card off a muted floor, where the warm ink of the shadow shows. */
function ShadowsSpecimen() {
  return (
    <div {...props(styles.elevations)}>
      {elevations.map((elevation) => (
        <span key={elevation} {...props(styles.elevation(elevation))} />
      ))}
    </div>
  );
}

/**
 * Pointing at the tile runs the puck along the curve it draws: the tile sets
 * `--design-active` to 1 while it is hovered or holds focus.
 */
function MotionSpecimen() {
  return (
    <div {...props(styles.motion)}>
      <svg viewBox="0 0 100 100" aria-hidden="true" {...props(styles.curve)}>
        <path d="M0 100 L100 0" {...props(styles.curveGuide)} />
        <path d="M0 100 C16 0 30 0 100 0" {...props(styles.curveLine)} />
      </svg>
      <span {...props(styles.track)}>
        <span {...props(styles.puck)} />
      </span>
      <code {...props(styles.caption)}>easeOutQuint</code>
    </div>
  );
}

const tokens = [
  ["--nyte-content-primary", role.contentPrimary],
  ["--nyte-bg-interactive-strong", role.bgInteractiveStrong],
  ["--nyte-stroke-tertiary", role.strokeTertiary],
  ["--nyte-focus-ring", appearance.focusRing],
] as const;

function TokensSpecimen() {
  return (
    <div {...props(styles.tokens)}>
      {tokens.map(([name, value]) => (
        <div key={name} {...props(styles.token)}>
          <span {...props(styles.tokenChip(value))} />
          <code {...props(styles.tokenName)}>{name}</code>
        </div>
      ))}
    </div>
  );
}

/** The same two controls under each scheme: every role is a `light-dark()` pair. */
function ThemingSpecimen() {
  return (
    <div {...props(styles.schemes)}>
      {(["light", "dark"] as const).map((scheme) => (
        <div key={scheme} {...props(styles.scheme(scheme))}>
          <Button variant="solid" tone="primary" size="sm">
            Save
          </Button>
          <Button variant="outline" size="sm">
            Cancel
          </Button>
          <code {...props(styles.caption)}>{scheme}</code>
        </div>
      ))}
    </div>
  );
}

function FocusSpecimen() {
  return (
    <div {...props(styles.focus)}>
      <span {...props(styles.ring)}>
        <Button variant="outline" tabIndex={-1}>
          Continue
        </Button>
      </span>
      <Kbd keys={["Tab"]} />
    </div>
  );
}

/** The glyphs drawn filled as well as outlined, each beside its twin. */
const iconPairs = ["star", "warning", "bubble-question"] as const;

function IconsSpecimen() {
  return (
    <div {...props(styles.iconPairs)}>
      {iconPairs.map((name) => (
        <div key={name} {...props(styles.iconPair)}>
          <Icon name={name} size="lg" />
          <Icon name={name} size="lg" variant="filled" />
        </div>
      ))}
    </div>
  );
}

export const foundationSpecimens = {
  colors: ColorsSpecimen,
  radius: RadiusSpecimen,
  spacing: SpacingSpecimen,
  typography: TypographySpecimen,
  shadows: ShadowsSpecimen,
  motion: MotionSpecimen,
  tokens: TokensSpecimen,
  theming: ThemingSpecimen,
  focus: FocusSpecimen,
  icons: IconsSpecimen,
} satisfies Readonly<Record<string, () => ReactElement>>;

const styles = create({
  swatches: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(36px, 1fr))",
    gap: space.s2,
    width: "100%",
    maxWidth: 520,
  },
  swatch: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
  },
  swatchFill: {
    width: "100%",
    height: 44,
    borderRadius: radius.control,
    backgroundColor: role.buttonFill,
  },
  swatchTint: {
    width: "100%",
    height: space.s3,
    borderRadius: radius.indicator,
    backgroundColor: role.fillTertiary,
  },
  swatchName: {
    marginBlockStart: space.s1,
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 10,
    lineHeight: "12px",
  },
  corners: { display: "flex", alignItems: "flex-end", gap: space.s3 },
  corner: (value: string) => ({
    width: 40,
    height: 40,
    borderStartStartRadius: value,
    borderStartEndRadius: value,
    borderEndStartRadius: value,
    borderEndEndRadius: value,
    backgroundColor: role.fillTertiary,
    boxShadow: `inset 0 0 0 1.5px ${role.contentQuaternary}`,
  }),
  steps: { display: "flex", flexDirection: "column", gap: space.s1_5, width: 160 },
  step: { display: "grid", gridTemplateColumns: "24px auto", alignItems: "center", gap: space.s2 },
  stepName: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 10,
    lineHeight: "12px",
    textAlign: "end",
  },
  stepBar: (value: string) => ({
    display: "block",
    width: `calc(${value} * 3)`,
    height: space.s2,
    borderRadius: 1,
    backgroundColor: role.contentSecondary,
  }),
  type: { display: "flex", alignItems: "center", gap: space.s8, maxWidth: "100%" },
  glyphs: {
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: 88,
    fontWeight: type.weightMedium,
    letterSpacing: "-0.04em",
    lineHeight: 1,
  },
  typeLines: { display: "flex", flexDirection: "column", gap: space.s1_5, minWidth: 0 },
  typeLine: {
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    alignItems: "baseline",
    gap: space.s2,
  },
  typeName: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 10,
    lineHeight: "12px",
  },
  typeSample: {
    overflow: "hidden",
    color: role.contentPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  elevations: {
    display: "flex",
    alignItems: "center",
    gap: space.s5,
    paddingBlock: space.s6,
    paddingInline: space.s6,
    borderRadius: radius.surface,
    backgroundColor: role.bgMuted,
  },
  elevation: (value: string) => ({
    width: 44,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: value,
  }),
  motion: {
    display: "grid",
    justifyItems: "center",
    gap: space.s3,
  },
  curve: { width: 96, height: 72, overflow: "visible" },
  curveGuide: {
    fill: "none",
    stroke: role.strokeQuaternary,
    strokeWidth: 1,
    vectorEffect: "non-scaling-stroke",
  },
  curveLine: {
    fill: "none",
    stroke: role.contentQuaternary,
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke",
  },
  track: {
    position: "relative",
    display: "block",
    width: 112,
    height: space.s2,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
  puck: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    width: space.s4,
    borderRadius: radius.pill,
    backgroundColor: role.contentQuaternary,
    transform: "translateX(calc(var(--design-active, 0) * 96px))",
    transitionProperty: "transform",
    transitionDuration: { default: "700ms", "@media (prefers-reduced-motion: reduce)": "0s" },
    transitionTimingFunction: motion.easeOutQuint,
  },
  caption: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 10,
    lineHeight: "12px",
  },
  tokens: { display: "flex", flexDirection: "column", gap: space.s2, maxWidth: "100%" },
  token: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  tokenChip: (value: string) => ({
    flexShrink: 0,
    width: space.s4,
    height: space.s4,
    borderRadius: radius.indicator,
    backgroundColor: value,
    boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
  }),
  tokenName: {
    overflow: "hidden",
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  schemes: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    width: "100%",
    maxWidth: 280,
    borderRadius: radius.card,
    overflow: "hidden",
    boxShadow: `0 0 0 1px ${role.strokeQuaternary}`,
  },
  scheme: (colorScheme: "light" | "dark") => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s4,
    colorScheme,
    backgroundColor: role.bgBase,
  }),
  focus: { display: "flex", alignItems: "center", gap: space.s3 },
  ring: {
    display: "inline-flex",
    borderRadius: radius.control,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: appearance.focusRing,
    outlineOffset: 2,
  },
  iconPairs: { display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: space.s6 },
  iconPair: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    color: role.contentPrimary,
  },
});
