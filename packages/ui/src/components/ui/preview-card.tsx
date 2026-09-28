import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { layer } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: 8,
    borderStyle: "none",
    borderRadius: t.radiusLg,
    outline: "none",
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
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
});

export type PreviewCardPositionerProps = StyledProps<PreviewCardPrimitive.Positioner.Props>;

function PreviewCardPositioner({
  positionMethod = "fixed",
  collisionPadding = 8,
  className,
  style,
  xstyle,
  ...rest
}: PreviewCardPositionerProps): ReactElement {
  return (
    <PreviewCardPrimitive.Positioner
      positionMethod={positionMethod}
      collisionPadding={collisionPadding}
      {...mergeStyleProps(props(styles.positioner, xstyle), className, style)}
      {...rest}
    />
  );
}

export type PreviewCardPopupProps = StyledProps<PreviewCardPrimitive.Popup.Props>;

function PreviewCardPopup({
  className,
  style,
  xstyle,
  ...rest
}: PreviewCardPopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <PreviewCardPrimitive.Popup
      ref={overlayRef}
      {...mergeStyleProps(
        props(floatingSurfaceStyles.popup, styles.popup, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export const PreviewCard = {
  Root: PreviewCardPrimitive.Root,
  Trigger: PreviewCardPrimitive.Trigger,
  Portal: PreviewCardPrimitive.Portal,
  Backdrop: PreviewCardPrimitive.Backdrop,
  Positioner: PreviewCardPositioner,
  Popup: PreviewCardPopup,
  Arrow: PreviewCardPrimitive.Arrow,
  Viewport: PreviewCardPrimitive.Viewport,
  createHandle: PreviewCardPrimitive.createHandle,
};
