import { mergeProps } from "@base-ui/react/merge-props";
import { PreviewCard } from "@base-ui/react/preview-card";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, useId, useState } from "react";
import type { ReactElement, RefAttributes } from "react";

import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { layer, shape } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { motion, role, type } from "../../vars.stylex.ts";
import { useLongPressPreview, useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: 8,
    borderStyle: "none",
    borderRadius: shape.control,
    outline: "none",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
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
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

const PreviewHandleContext = createContext<
  Pick<PreviewCard.Handle<unknown>, "open" | "close"> | undefined
>(undefined);

export type PreviewCardRootProps<Payload = unknown> = PreviewCard.Root.Props<Payload>;

function PreviewCardRoot<Payload>({
  handle: externalHandle,
  ...rest
}: PreviewCardRootProps<Payload>): ReactElement {
  const [internalHandle] = useState(() => PreviewCard.createHandle<Payload>());
  const handle = externalHandle ?? internalHandle;

  return (
    <PreviewHandleContext value={handle}>
      <PreviewCard.Root {...rest} handle={handle} />
    </PreviewHandleContext>
  );
}

export type PreviewCardTriggerProps<Payload = unknown> = PreviewCard.Trigger.Props<Payload> &
  RefAttributes<HTMLElement>;

function PreviewCardTrigger<Payload>({
  handle,
  id,
  ...rest
}: PreviewCardTriggerProps<Payload>): ReactElement {
  const contextHandle = use(PreviewHandleContext);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const longPress = useLongPressPreview(() => {
    (handle ?? contextHandle)?.open(triggerId);
  });

  return <PreviewCard.Trigger {...mergeProps(rest, longPress)} id={triggerId} handle={handle} />;
}

export type PreviewCardBackdropProps = StyledProps<Omit<PreviewCard.Backdrop.Props, "ref">>;

function PreviewCardBackdrop({
  xstyle,
  className,
  style,
  ...rest
}: PreviewCardBackdropProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <PreviewCard.Backdrop
      {...rest}
      ref={overlayRef}
      {...mergeStyleProps(props(xstyle), className, style)}
    />
  );
}

export type PreviewCardPositionerProps = StyledProps<PreviewCard.Positioner.Props>;

function PreviewCardPositioner({
  positionMethod = "fixed",
  collisionPadding = 8,
  className,
  style,
  xstyle,
  ...rest
}: PreviewCardPositionerProps): ReactElement {
  return (
    <PreviewCard.Positioner
      positionMethod={positionMethod}
      collisionPadding={collisionPadding}
      {...mergeStyleProps(props(styles.positioner, xstyle), className, style)}
      {...rest}
    />
  );
}

export type PreviewCardPopupProps = StyledProps<Omit<PreviewCard.Popup.Props, "ref">> & {
  /** Scopes the popup to a hue. */
  readonly tint?: Tint;
};

function PreviewCardPopup({
  tint,
  className,
  style,
  xstyle,
  ...rest
}: PreviewCardPopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <PreviewCard.Popup
      ref={overlayRef}
      {...mergeStyleProps(
        props(
          tint !== undefined && surfaceTheme[tint],
          floatingSurfaceStyles.popup,
          styles.popup,
          xstyle,
        ),
        className,
        style,
      )}
      {...rest}
    />
  );
}

const previewCardParts = {
  Root: PreviewCardRoot,
  Trigger: PreviewCardTrigger,
  Portal: PreviewCard.Portal,
  Backdrop: PreviewCardBackdrop,
  Positioner: PreviewCardPositioner,
  Popup: PreviewCardPopup,
  Arrow: PreviewCard.Arrow,
  Viewport: PreviewCard.Viewport,
  createHandle: PreviewCard.createHandle,
};

export { previewCardParts as PreviewCard };
