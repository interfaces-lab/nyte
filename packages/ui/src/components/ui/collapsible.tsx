import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { button } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { appearance, motion, role } from "../../vars.stylex.ts";
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
    minHeight: { default: button.heightSm, "@media (pointer: coarse)": 44 },
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
    color: role.contentInteractiveTertiary,
    transform: "rotate(var(--_collapsible-chevron-rotate, 0deg))",
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
});

/**
 * `disclosure` is a quiet inline toggle. `plain` only resets the button, for a
 * trigger rendered as another styled part such as `Row.Primary`.
 */
export type CollapsibleTriggerVariant = "disclosure" | "plain";

export type CollapsibleRootProps = StyledProps<CollapsiblePrimitive.Root.Props>;

export type CollapsibleTriggerProps = StyledProps<CollapsiblePrimitive.Trigger.Props> & {
  readonly variant?: CollapsibleTriggerVariant;
};

export type CollapsiblePanelProps = StyledProps<CollapsiblePrimitive.Panel.Props>;

export type CollapsibleChevronProps = StyledProps<ComponentProps<"span">> & {
  readonly size?: number;
};

function CollapsibleRoot({
  xstyle,
  className,
  style,
  ...rest
}: CollapsibleRootProps): ReactElement {
  return (
    <CollapsiblePrimitive.Root {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
  );
}

function CollapsibleTrigger({
  variant = "disclosure",
  onClick,
  xstyle,
  className,
  style,
  ...rest
}: CollapsibleTriggerProps): ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      {...rest}
      onClick={(event) => {
        const childControl =
          event.target instanceof Element
            ? event.target.closest("a, button, input, textarea, select, [role=button]")
            : null;

        if (
          event.shiftKey ||
          event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false ||
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
}: CollapsiblePanelProps): ReactElement {
  return (
    <CollapsiblePrimitive.Panel
      hiddenUntilFound
      {...rest}
      {...mergeStyleProps(props(styles.panel, xstyle), className, style)}
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
}: CollapsibleChevronProps): ReactElement {
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
};
