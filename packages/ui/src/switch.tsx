import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { create, props } from "@stylexjs/stylex";
import { useId, type ComponentProps, type ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { row, radius, switchControl, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent } from "./surface-theme.ts";
import { appearance, motion, role, shadow, type } from "./vars.stylex.ts";

const styles = create({
  target: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: `max(${target.min}, ${switchControl.widthMd})`,
    height: `max(${target.min}, ${switchControl.heightMd})`,
  },
  field: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    minHeight: row.heightMd,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    cursor: appearance.cursorInteractive,
  },
  copy: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  description: { color: role.contentSecondary, fontSize: type.fontSm },
  track: {
    "::before": {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      translate: "-50% -50%",
      width: `max(${target.min}, ${switchControl.widthMd})`,
      height: `max(${target.min}, ${switchControl.heightMd})`,
    },
    appearance: "none",
    boxSizing: "border-box",
    position: "relative",
    flexShrink: 0,
    boxShadow: "none",
    display: "inline-flex",
    alignItems: "center",
    width: switchControl.widthMd,
    height: switchControl.heightMd,
    padding: switchControl.paddingMd,
    borderStyle: "none",
    borderRadius: radius.pill,
    backgroundColor: {
      default: role.bgControl,
      ":hover:not([data-disabled])": role.bgControlHover,
      ":active:not([data-disabled])": role.bgControlPressed,
      "[data-checked]": role.bgControlSelected,
      ":hover:is([data-checked]):not([data-disabled])": role.bgControlSelectedHover,
      ":active:is([data-checked]):not([data-disabled])": role.bgControlSelectedPressed,
    },
    opacity: { default: 1, "[data-disabled]": 0.5 },
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
  },
  thumb: {
    display: "block",
    width: switchControl.knobMd,
    height: switchControl.knobMd,
    borderRadius: radius.pill,
    backgroundColor: role.contentOnControl,
    boxShadow: shadow.shadowSm,
    transform: {
      default: "translateX(0)",
      "[data-checked]": `translateX(calc(${switchControl.widthMd} - ${switchControl.knobMd} - ${switchControl.paddingMd} * 2))`,
    },
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationSlow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeInOutStrong,
  },
});

function SwitchControl({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<SwitchPrimitive.Root.Props, "children">>): ReactElement {
  return (
    <span {...props(styles.target)}>
      <SwitchPrimitive.Root
        {...rest}
        {...mergeStyleProps(
          props(intent.primary, styles.track, focus.ring, xstyle),
          className,
          style,
        )}
      >
        <SwitchPrimitive.Thumb {...props(styles.thumb)} />
      </SwitchPrimitive.Root>
    </span>
  );
}

export function Switch({
  label,
  ...rest
}: ComponentProps<typeof SwitchControl> & { readonly label: string }): ReactElement {
  return <SwitchControl aria-label={label} {...rest} />;
}

export type SwitchFieldProps = Omit<
  ComponentProps<typeof SwitchControl>,
  "aria-label" | "aria-labelledby" | "nativeButton"
> & {
  readonly label: string;
  readonly description?: string;
};

export function SwitchField({
  label,
  description,
  id,
  xstyle,
  className,
  style,
  ...rest
}: SwitchFieldProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description === undefined ? undefined : `${controlId}-description`;

  return (
    <label
      htmlFor={controlId}
      onClickCapture={(event) => {
        if (
          event.shiftKey ||
          event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      {...mergeStyleProps(props(styles.field, xstyle), className, style)}
    >
      <span {...props(styles.copy)}>
        <span id={labelId}>{label}</span>
        {description !== undefined && (
          <span id={descriptionId} {...props(styles.description)}>
            {description}
          </span>
        )}
      </span>
      <SwitchControl
        {...rest}
        id={controlId}
        aria-labelledby={labelId}
        aria-describedby={
          [rest["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined
        }
      />
    </label>
  );
}
