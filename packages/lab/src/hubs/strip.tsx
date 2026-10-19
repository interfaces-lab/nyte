/**
 * The strip across the top of a settings page: one emblem per page, drawn
 * wide and short on a dot field washed in the page's hue. The art sits on a
 * 1200 × 200 board centred on (600, 100) and crops at the sides, so a narrow
 * page keeps the emblem and a wide one shows more of the field. Keep the
 * emblem inside x 350 to 850 to survive the narrowest page.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { createContext, useId, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme, type Tint } from "@nyte-ai/ui/surface-theme";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const BOARD = { w: 1200, h: 200, cx: 600, cy: 100 } as const;

/** The id of the strip's falloff mask: texture at the sides fades out toward the board's edge. */
export const Falloff = createContext("");

/** A repeatable stream of numbers in [0, 1), so generated texture is the same on every render. */
export function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}

/** An icon centred on (x, y), in the strip's coordinates. */
export function Glyph({
  name,
  x,
  y,
  size,
  tone = "tertiary",
}: {
  readonly name: IconName;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly tone?: "tertiary" | "primary" | "inverse";
}): ReactElement {
  return (
    <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size}>
      <div
        {...props(
          ink.glyph,
          tone === "primary" && ink.glyphPrimary,
          tone === "inverse" && ink.glyphInverse,
        )}
      >
        <Icon name={name} size={size} />
      </div>
    </foreignObject>
  );
}

export function Strip({
  tint,
  hue,
  caption,
  dim = false,
  children,
}: {
  readonly tint: Tint;
  /** With the custom tint: the hue in degrees and the chroma scale from 0 to 1. */
  readonly hue?: { readonly degrees: number; readonly chroma: number };
  readonly caption?: ReactNode;
  /** While the page loads, the emblem breathes. */
  readonly dim?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const id = useId();
  const dots = `${id}-dots`;
  const glow = `${id}-glow`;
  const falloff = `${id}-falloff`;
  const falloffRamp = `${id}-falloff-ramp`;

  return (
    <figure
      ref={(node) => {
        if (node === null || hue === undefined) return;
        node.style.setProperty("--nyte-custom-hue", String(hue.degrees));
        node.style.setProperty("--nyte-custom-chroma-scale", String(hue.chroma));
      }}
      {...props(surfaceTheme[tint], styles.strip)}
    >
      <svg
        viewBox={`0 0 ${BOARD.w} ${BOARD.h}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        {...props(styles.board)}
      >
        <defs>
          <pattern id={dots} width={16} height={16} patternUnits="userSpaceOnUse">
            <circle cx={8} cy={8} r={0.9} {...props(ink.strongFill)} />
          </pattern>
          <radialGradient id={glow}>
            <stop offset="0" stopOpacity={0.34} {...props(styles.glowStop)} />
            <stop offset="0.55" stopOpacity={0.1} {...props(styles.glowStop)} />
            <stop offset="1" stopOpacity={0} {...props(styles.glowStop)} />
          </radialGradient>
          <radialGradient id={falloffRamp}>
            <stop offset="0" stopOpacity={1} {...props(styles.maskStop)} />
            <stop offset="0.7" stopOpacity={0.7} {...props(styles.maskStop)} />
            <stop offset="1" stopOpacity={0.05} {...props(styles.maskStop)} />
          </radialGradient>
          <mask id={falloff} {...props(styles.alphaMask)}>
            <rect width={BOARD.w} height={BOARD.h} fill={`url(#${falloffRamp})`} />
          </mask>
        </defs>
        <rect width={BOARD.w} height={BOARD.h} {...props(ink.baseFill, styles.wash)} />
        <rect width={BOARD.w} height={BOARD.h} fill={`url(#${glow})`} />
        <rect width={BOARD.w} height={BOARD.h} fill={`url(#${dots})`} mask={`url(#${falloff})`} />
        <Falloff value={falloff}>
          <g {...props(dim && styles.breathing)}>{children}</g>
        </Falloff>
      </svg>
      {caption !== undefined && <figcaption {...props(styles.caption)}>{caption}</figcaption>}
    </figure>
  );
}

const breathe = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.4 } });

export const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  strip: {
    position: "relative",
    height: 200,
    margin: 0,
    overflow: "clip",
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    isolation: "isolate",
  },
  board: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    display: "block",
    width: "100%",
    height: "100%",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  wash: { fill: role.bgMuted },
  glowStop: { stopColor: role.chartSeries },
  maskStop: { stopColor: role.contentPrimary },
  alphaMask: { maskType: "alpha" },
  breathing: {
    animationName: { default: breathe, [reduced]: "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeInOutStrong,
  },
  caption: {
    position: "absolute",
    insetInlineStart: space.s4,
    insetBlockEnd: space.s3,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
});

/** The strip's inks. Each reads a role, so it follows the scope's hue and the scheme. */
export const ink = create({
  baseFill: { fill: role.bgBase },
  mutedFill: { fill: role.borderPrimary },
  strongFill: { fill: role.borderStrong },
  tertiaryFill: { fill: role.contentTertiary },
  secondaryFill: { fill: role.contentSecondary },
  primaryFill: { fill: role.contentPrimary },
  accentFill: { fill: role.chartSeries },
  strongAccentFill: { fill: role.bgInteractiveStrong },
  inverseFill: { fill: role.contentOnInteractiveStrong },
  solid: { fill: role.bgBase, stroke: role.contentTertiary, strokeWidth: 1.1 },
  line: { fill: "none", stroke: role.contentTertiary, strokeWidth: 1.1 },
  faint: { fill: "none", stroke: role.borderPrimary, strokeWidth: 1 },
  strong: { fill: "none", stroke: role.borderStrong, strokeWidth: 1 },
  accent: { fill: "none", stroke: role.chartSeries, strokeWidth: 1.6 },
  bloom: { filter: "blur(7px)" },
  mono: { fontFamily: type.fontMono },
  sans: { fontFamily: type.fontSans },
  glyph: {
    display: "flex",
    width: "100%",
    height: "100%",
    color: role.contentTertiary,
    transitionProperty: "color",
    transitionDuration: motion.durationNormal,
  },
  glyphPrimary: { color: role.contentPrimary },
  glyphInverse: { color: role.contentOnInteractiveStrong },
  fade: { transitionProperty: "opacity", transitionDuration: motion.durationNormal },
});
