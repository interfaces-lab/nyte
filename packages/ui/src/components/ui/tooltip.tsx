import { Tooltip } from "@base-ui/react/tooltip";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { clipboardPreview, layer } from "../../schema.stylex.ts";
import type { XStyle } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.tooltip, outline: "none" },
  popup: {
    maxWidth: 260,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: t.radiusBase,
    backgroundColor: t.bgRaised,
    boxShadow: `${t.shadowPopover}, inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    whiteSpace: "pre-line",
    overflowWrap: "anywhere",
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: {
      default: 1,
      "[data-starting-style]": 0.98,
      "[data-ending-style]": 0.98,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  preview: {
    maxWidth: clipboardPreview.maxWidth,
    maxHeight: clipboardPreview.maxHeight,
    overflowY: "auto",
    overflowWrap: "anywhere",
    fontFamily: t.fontMono,
    whiteSpace: "pre-wrap",
  },
});

export type HintSide = Tooltip.Positioner.Props["side"];

export type HintAlign = Tooltip.Positioner.Props["align"];

export interface HintProps {
  readonly content: ReactNode;
  readonly trigger: ReactElement;
  readonly side?: HintSide;
  readonly align?: HintAlign;
  /** Merged last onto the popup. */
  readonly xstyle?: XStyle;
}

/** Shares one open delay across every `Hint` inside it. */
export const HintProvider = Tooltip.Provider;

export function Hint({
  content,
  trigger,
  side = "bottom",
  align = "center",
  xstyle,
}: HintProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          positionMethod="fixed"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          {...props(styles.positioner)}
        >
          <Tooltip.Popup ref={overlayRef} {...props(styles.popup, xstyle)}>
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export type HoverPreviewProps = Omit<HintProps, "align" | "xstyle">;

/** A `Hint` for long monospace text such as a pasted snippet, scrolling past its bounds. */
export function HoverPreview({ content, trigger, side }: HoverPreviewProps): ReactElement {
  return <Hint content={content} trigger={trigger} side={side} xstyle={styles.preview} />;
}
