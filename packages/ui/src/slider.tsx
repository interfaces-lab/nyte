import { shape, slider, target } from "./schema.stylex.ts";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent } from "./surface-theme.ts";
import { appearance, role, shadow, type } from "./vars.stylex.ts";

const styles = create({
  label: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  value: {
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  control: {
    display: "flex",
    alignItems: "center",
    width: { default: "100%", '[data-orientation="vertical"]': target.min },
    height: { default: target.min, '[data-orientation="vertical"]': "100%" },
    minWidth: target.min,
    minHeight: target.min,
    cursor: appearance.cursorInteractive,
    touchAction: "none",
    userSelect: "none",
  },
  track: {
    position: "relative",
    width: { default: "100%", '[data-orientation="vertical"]': 6 },
    height: { default: 6, '[data-orientation="vertical"]': "100%" },
    borderRadius: shape.indicator,
    backgroundColor: role.bgControl,
    userSelect: "none",
  },
  // The filled part paints inside the primary intent.
  indicator: {
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: role.bgControlSelected,
  },
  thumb: {
    boxSizing: "border-box",
    width: target.min,
    height: target.min,
    "::before": {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      translate: "-50% -50%",
      boxSizing: "border-box",
      width: slider.thumb,
      height: slider.thumb,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: role.borderControl,
      borderRadius: shape.pill,
      backgroundColor: role.contentOnControl,
      boxShadow: shadow.shadowSm,
    },
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
    userSelect: "none",
  },
});

// Range thumbs use the control's nearest-thumb hit test instead of overlapping hit boxes.
const range = create({ thumb: { pointerEvents: "none" } });
const SliderRangeContext = createContext(false);

export type SliderRootProps<Value extends number | readonly number[]> = StyledProps<
  SliderPrimitive.Root.Props<Value>
>;
export type SliderLabelProps = StyledProps<SliderPrimitive.Label.Props>;
export type SliderValueProps = StyledProps<SliderPrimitive.Value.Props>;
export type SliderControlProps = StyledProps<SliderPrimitive.Control.Props>;
export type SliderTrackProps = StyledProps<SliderPrimitive.Track.Props>;
export type SliderIndicatorProps = StyledProps<SliderPrimitive.Indicator.Props>;
export type SliderThumbProps = StyledProps<SliderPrimitive.Thumb.Props>;

function SliderRoot<Value extends number | readonly number[]>({
  xstyle,
  className,
  style,
  ...rest
}: SliderRootProps<Value>): ReactElement {
  const value = rest.value ?? rest.defaultValue;
  const isRange = typeof value !== "number" && value !== undefined && value.length > 1;

  return (
    <SliderRangeContext value={isRange}>
      <SliderPrimitive.Root<Value>
        thumbAlignment="edge"
        {...rest}
        {...mergeStyleProps(props(xstyle), className, style)}
      />
    </SliderRangeContext>
  );
}

function SliderLabel({ xstyle, className, style, ...rest }: SliderLabelProps): ReactElement {
  return (
    <SliderPrimitive.Label
      {...rest}
      {...mergeStyleProps(props(styles.label, xstyle), className, style)}
    />
  );
}

function SliderValue({ xstyle, className, style, ...rest }: SliderValueProps): ReactElement {
  return (
    <SliderPrimitive.Value
      {...rest}
      {...mergeStyleProps(props(styles.value, xstyle), className, style)}
    />
  );
}

function SliderControl({ xstyle, className, style, ...rest }: SliderControlProps): ReactElement {
  return (
    <SliderPrimitive.Control
      {...rest}
      {...mergeStyleProps(props(styles.control, xstyle), className, style)}
    />
  );
}

function SliderTrack({ xstyle, className, style, ...rest }: SliderTrackProps): ReactElement {
  return (
    <SliderPrimitive.Track
      {...rest}
      {...mergeStyleProps(props(styles.track, xstyle), className, style)}
    />
  );
}

function SliderIndicator({
  xstyle,
  className,
  style,
  ...rest
}: SliderIndicatorProps): ReactElement {
  return (
    <SliderPrimitive.Indicator
      {...rest}
      {...mergeStyleProps(props(intent.primary, styles.indicator, xstyle), className, style)}
    />
  );
}

function SliderThumb({ xstyle, className, style, ...rest }: SliderThumbProps): ReactElement {
  const isRange = use(SliderRangeContext);

  return (
    <SliderPrimitive.Thumb
      {...rest}
      {...mergeStyleProps(props(styles.thumb, isRange && range.thumb, xstyle), className, style)}
    />
  );
}

export const Slider = {
  Root: SliderRoot,
  Label: SliderLabel,
  Value: SliderValue,
  Control: SliderControl,
  Track: SliderTrack,
  Indicator: SliderIndicator,
  Thumb: SliderThumb,
};
