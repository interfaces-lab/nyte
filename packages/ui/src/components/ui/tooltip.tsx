import { Tooltip } from "@base-ui/react/tooltip";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { clipboardPreview, layer, shape } from "../../schema.stylex.ts";
import type { XStyle } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { motion, role, shadow, type } from "../../vars.stylex.ts";
import { useLongPressPreview, useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.tooltip, outline: "none" },
  popup: {
    maxWidth: 260,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: shape.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
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
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  preview: {
    maxWidth: clipboardPreview.maxWidth,
    maxHeight: clipboardPreview.maxHeight,
    overflowY: "auto",
    overflowWrap: "anywhere",
    fontFamily: type.fontMono,
    whiteSpace: "pre-wrap",
  },
});

export type HintSide = Tooltip.Positioner.Props["side"];

export type HintAlign = Tooltip.Positioner.Props["align"];

export type HintProps = Pick<Tooltip.Root.Props, "disabled"> &
  Pick<Tooltip.Positioner.Props, "side" | "align"> & {
    readonly content: ReactNode;
    readonly trigger: NonNullable<Tooltip.Trigger.Props["render"]>;
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
    /** Merged last onto the popup. */
    readonly xstyle?: XStyle;
  };

const HintTimingContext = createContext({ delay: 300, closeDelay: 100 });

export type HintProviderProps = Tooltip.Provider.Props;

export function HintProvider({
  delay = 300,
  closeDelay = 100,
  timeout = 200,
  children,
}: HintProviderProps): ReactElement {
  return (
    <HintTimingContext value={{ delay, closeDelay }}>
      <Tooltip.Provider delay={delay} closeDelay={closeDelay} timeout={timeout}>
        {children}
      </Tooltip.Provider>
    </HintTimingContext>
  );
}

export function Hint({
  content,
  trigger,
  side = "bottom",
  align = "center",
  disabled,
  tint,
  xstyle,
}: HintProps): ReactElement {
  const overlayRef = useOverlayRef();
  const timing = use(HintTimingContext);
  const [handle] = useState(() => Tooltip.createHandle());
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const popupId = `${triggerId}-hint`;
  const longPress = useLongPressPreview(() => handle.open(triggerId), disabled);

  return (
    <Tooltip.Root disabled={disabled} handle={handle} onOpenChange={setOpen}>
      <Tooltip.Trigger
        {...longPress}
        id={triggerId}
        aria-describedby={open ? popupId : undefined}
        render={trigger}
        delay={timing.delay}
        closeDelay={timing.closeDelay}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner
          positionMethod="fixed"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          {...props(styles.positioner)}
        >
          <Tooltip.Popup
            ref={overlayRef}
            id={popupId}
            role="tooltip"
            {...props(tint !== undefined && surfaceTheme[tint], styles.popup, xstyle)}
          >
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export type HoverPreviewProps = Omit<HintProps, "align" | "xstyle">;

/** A `Hint` for long monospace text such as a pasted snippet, scrolling past its bounds. */
export function HoverPreview({
  content,
  trigger,
  side,
  disabled,
  tint,
}: HoverPreviewProps): ReactElement {
  return (
    <Hint
      content={content}
      trigger={trigger}
      side={side}
      disabled={disabled}
      tint={tint}
      xstyle={styles.preview}
    />
  );
}
