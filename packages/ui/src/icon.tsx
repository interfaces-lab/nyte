import { create, props } from "@stylexjs/stylex";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, use, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { FILLED_GLYPHS, GLYPHS } from "./glyphs/selected.ts";
import type { FilledIconName, IconName } from "./icon-names.ts";
import { mergeStyleProps } from "./style.ts";
import { glyph } from "./styles/schema.stylex.ts";
import type { Restyle } from "./styles/contracts.ts";

export type { FilledIconName, IconName } from "./icon-names.ts";

const styles = create({
  frame: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  swap: { display: "inline-grid", flexShrink: 0 },
  swapLayer: { display: "inline-grid", gridArea: "1 / 1" },
});

const SWAP_HIDDEN = { opacity: 0, scale: 0.25, filter: "blur(4px)" };

const SWAP_SHOWN = { opacity: 1, scale: 1, filter: "blur(0px)" };

const glyphSizes = create({
  "2xs": { width: glyph["2xs"], height: glyph["2xs"] },
  xs: { width: glyph.xs, height: glyph.xs },
  sm: { width: glyph.sm, height: glyph.sm },
  md: { width: glyph.md, height: glyph.md },
  lg: { width: glyph.lg, height: glyph.lg },
});

/** A step on the glyph scale: 10, 12, 14, 16 or 20 px at the default size. */
export type GlyphSize = keyof typeof glyphSizes;

const ControlGlyphContext = createContext(false);

export function ControlGlyphs({ children }: { readonly children: ReactNode }): ReactElement {
  return <ControlGlyphContext value={true}>{children}</ControlGlyphContext>;
}

interface IconFrameProps {
  readonly size: GlyphSize;
  readonly label?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"Icon">;
}

function IconFrame({
  size,
  label,
  children,
  className,
  style,
  xstyle,
}: IconFrameProps): ReactElement {
  const controlled = use(ControlGlyphContext);
  const a11y = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  const frame = mergeStyleProps(props(styles.frame, glyphSizes[size], xstyle), className, style);

  return (
    <span
      {...a11y}
      data-nyte-icon=""
      {...frame}
      style={controlled ? { ...frame.style, color: "inherit", opacity: 1 } : frame.style}
    >
      {children}
    </span>
  );
}

export type IconProps = {
  readonly size?: GlyphSize;
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"Icon">;
} & (
  | { readonly name: IconName; readonly variant?: "outlined" }
  | { readonly name: FilledIconName; readonly variant: "filled" }
);

export function Icon(iconProps: IconProps): ReactElement {
  const { size = "md", label, className, style, xstyle } = iconProps;

  const Glyph =
    iconProps.variant === "filled" ? FILLED_GLYPHS[iconProps.name] : GLYPHS[iconProps.name];

  return (
    <IconFrame size={size} label={label} className={className} style={style} xstyle={xstyle}>
      <Glyph size="100%" />
    </IconFrame>
  );
}

/** An icon that cross-fades when its glyph changes, such as copy turning into a checkmark. */
export function IconSwap(iconProps: IconProps): ReactElement {
  const reducedMotion = useReducedMotion();

  return (
    <span {...props(styles.swap)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={`${iconProps.variant ?? "outlined"}:${iconProps.name}`}
          className={props(styles.swapLayer).className}
          initial={reducedMotion ? { opacity: 0 } : SWAP_HIDDEN}
          animate={SWAP_SHOWN}
          exit={reducedMotion ? { opacity: 0 } : SWAP_HIDDEN}
          transition={
            reducedMotion ? { duration: 0.15 } : { type: "spring", duration: 0.3, bounce: 0 }
          }
        >
          <Icon {...iconProps} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export type PanelSide = "left" | "right";

const DIVIDER_X: Readonly<Record<PanelSide, Readonly<Record<"visible" | "hidden", number>>>> = {
  left: { visible: 9, hidden: 6.25 },
  right: { visible: 15, hidden: 17.75 },
};

function panelDividerPath(side: PanelSide, visible: boolean): string {
  const x = String(DIVIDER_X[side][visible ? "visible" : "hidden"]);

  return visible ? `M${x} 4.75V12V19.25` : `M${x} 8.25V12V15.75`;
}

const PANEL_FRAME_PATH =
  "M2.75 6.75C2.75 5.64543 3.64543 4.75 4.75 4.75H19.25C20.3546 4.75 21.25 5.64543 21.25 6.75V17.25C21.25 18.3546 20.3546 19.25 19.25 19.25H4.75C3.64543 19.25 2.75 18.3546 2.75 17.25V6.75Z";

export interface PanelToggleIconProps {
  readonly side: PanelSide;
  readonly visible: boolean;
  readonly size?: GlyphSize;
}

export function PanelToggleIcon({
  side,
  visible,
  size = "md",
}: PanelToggleIconProps): ReactElement {
  const reducedMotion = useReducedMotion();

  return (
    <IconFrame size={size}>
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d={PANEL_FRAME_PATH} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        <motion.path
          initial={false}
          animate={{ d: panelDividerPath(side, visible) }}
          transition={
            reducedMotion ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0 }
          }
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap={visible ? undefined : "round"}
          strokeLinejoin="round"
        />
      </svg>
    </IconFrame>
  );
}
