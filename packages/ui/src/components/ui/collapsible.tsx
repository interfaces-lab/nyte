import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
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
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
  },
  disclosure: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    minWidth: 0,
    color: {
      default: t.contentInteractiveSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.contentInteractivePrimary },
    },
    userSelect: "none",
    transitionProperty: "color",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: t.contentInteractiveTertiary,
    transform: "rotate(var(--_collapsible-chevron-rotate, 0deg))",
    transitionProperty: "transform",
    transitionDuration: {
      default: t.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOutQuint,
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
  xstyle,
  className,
  style,
  ...rest
}: CollapsibleTriggerProps): ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      {...rest}
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
    <CollapsiblePrimitive.Panel {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
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
