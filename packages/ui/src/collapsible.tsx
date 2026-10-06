import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { appearance, motion, role } from "./vars.stylex.ts";
import { Icon } from "./icon.tsx";

const styles = create({
  trigger: {
    // The chevron cannot read the trigger's state, so the trigger publishes it.
    "--_collapsible-chevron-rotate": { default: "0deg", "[data-panel-open]": "90deg" },
    appearance: "none",
    margin: 0,
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    letterSpacing: "inherit",
    textAlign: "start",
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
  },
  disclosure: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: target.min,
    gap: 4,
    maxWidth: "100%",
    minWidth: 0,
    color: {
      default: role.contentInteractiveSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentInteractivePrimary },
    },
    userSelect: "none",
    transitionProperty: "color",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  panel: {
    height: "var(--collapsible-panel-height)",
    overflow: "hidden",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transitionProperty: "height, opacity",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
    "[data-starting-style]": { height: 0 },
    "[data-ending-style]": { height: 0 },
  },
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transform: "rotate(var(--_collapsible-chevron-rotate, 0deg))",
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
});

/** A preview whose collapsible is closed. Base UI marks an open one `data-panel-open`. */
const PREVIEWING = '[data-slot="collapsible-preview"]:not([data-panel-open])';

/** Shift extends a selection and a drag ends one. Neither press toggles anything. */
function selecting(event: {
  readonly shiftKey: boolean;
  readonly currentTarget: Element;
}): boolean {
  return event.shiftKey || event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false;
}

function CollapsibleRoot({
  onOpenChange,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<CollapsiblePrimitive.Root.Props>): ReactElement {
  return (
    <CollapsiblePrimitive.Root
      {...rest}
      onOpenChange={(open, details) => {
        const { target } = details.event;

        // A press inside a closed preview only reveals, so a disclosure there stays open.
        if (!open && target instanceof Element && target.closest(PREVIEWING) !== null) {
          details.cancel();
          onOpenChange?.(true, details);

          return;
        }

        onOpenChange?.(open, details);
      }}
      {...mergeStyleProps(props(xstyle), className, style)}
    />
  );
}

function CollapsibleTrigger({
  variant = "disclosure",
  onClick,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<CollapsiblePrimitive.Trigger.Props> & {
  readonly variant?: "disclosure" | "plain";
}): ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      {...rest}
      onClick={(event) => {
        const childControl =
          event.target instanceof Element
            ? event.target.closest("a, button, input, textarea, select, [role=button]")
            : null;

        if (
          selecting(event) ||
          (childControl !== null &&
            childControl !== event.currentTarget &&
            event.currentTarget.contains(childControl))
        ) {
          event.preventDefault();
          event.preventBaseUIHandler();

          return;
        }

        onClick?.(event);
      }}
      {...mergeStyleProps(
        props(styles.trigger, variant === "disclosure" && [styles.disclosure, focus.ring], xstyle),
        className,
        style,
      )}
    />
  );
}

function CollapsiblePanel({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<CollapsiblePrimitive.Panel.Props>): ReactElement {
  return (
    <CollapsiblePrimitive.Panel
      hiddenUntilFound
      {...rest}
      {...mergeStyleProps(props(styles.panel, xstyle), className, style)}
    />
  );
}

/**
 * What a closed collapsible still shows of its content, when that content has
 * controls of its own. Closed, a press anywhere in it opens the collapsible, and
 * a disclosure pressed inside opens without closing. Open, it is a plain
 * container. The trigger stays the accessible control, so the preview takes no
 * role and no tab stop.
 */
function CollapsiblePreview({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ComponentProps<"div">>): ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      nativeButton={false}
      onClick={(event) => {
        if (selecting(event) || !event.currentTarget.matches(PREVIEWING))
          event.preventBaseUIHandler();
      }}
      render={
        <div
          role={undefined}
          tabIndex={undefined}
          aria-expanded={undefined}
          aria-controls={undefined}
          {...rest}
          data-slot="collapsible-preview"
          {...mergeStyleProps(props(xstyle), className, style)}
        />
      }
    />
  );
}

/** A chevron that turns a quarter while its trigger's panel is open. Place it inside the trigger. */
function CollapsibleChevron({
  size = 11,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ComponentProps<"span">> & {
  readonly size?: number;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-slot="collapsible-chevron"
      {...rest}
      {...mergeStyleProps(props(styles.chevron, xstyle), className, style)}
    >
      <Icon name="chevron-right" size={size} />
    </span>
  );
}

export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
  Chevron: CollapsibleChevron,
  Preview: CollapsiblePreview,
};
