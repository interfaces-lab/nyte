import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { intent } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  label: {
    color: t.contentPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  value: {
    color: t.contentSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  control: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: 16,
    cursor: t.cursorInteractive,
    touchAction: "none",
    userSelect: "none",
  },
  track: {
    position: "relative",
    width: "100%",
    height: 6,
    borderRadius: t.radius2,
    backgroundColor: t.bgControl,
    userSelect: "none",
  },
  // The filled part paints inside the primary intent.
  indicator: {
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: t.bgControlSelected,
  },
  thumb: {
    boxSizing: "border-box",
    width: 14,
    height: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.borderControl,
    borderRadius: t.radiusFull,
    backgroundColor: t.contentOnControl,
    boxShadow: t.shadowSm,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: t.focusRing,
    outlineOffset: 2,
    userSelect: "none",
  },
});

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
  return (
    <SliderPrimitive.Root<Value> {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
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
  return (
    <SliderPrimitive.Thumb
      {...rest}
      {...mergeStyleProps(props(styles.thumb, xstyle), className, style)}
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
