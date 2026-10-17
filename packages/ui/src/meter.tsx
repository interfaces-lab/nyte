import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { radius, space } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { motion, role } from "./styles/vars.stylex.ts";

const styles = create({
  root: { display: "flex", flexDirection: "column", gap: space.s1_5, minWidth: 0 },
  label: { color: role.contentPrimary },
  value: {
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  track: {
    height: 4,
    overflow: "clip",
    borderRadius: radius.indicator,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  indicator: {
    height: "100%",
    backgroundColor: role.bgInteractiveStrong,
    transitionProperty: "width, background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
});

function MeterRoot({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Root.Props, Restyle<"Meter.Root">>): ReactElement {
  return (
    <MeterPrimitive.Root
      {...rest}
      {...mergeStyleProps(props(styles.root, xstyle), className, style)}
    />
  );
}

function MeterLabel({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Label.Props, Restyle<"Meter.Label">>): ReactElement {
  return (
    <MeterPrimitive.Label
      {...rest}
      {...mergeStyleProps(props(text.sm, styles.label, xstyle), className, style)}
    />
  );
}

function MeterValue({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Value.Props, Restyle<"Meter.Value">>): ReactElement {
  return (
    <MeterPrimitive.Value
      {...rest}
      {...mergeStyleProps(props(text.sm, styles.value, xstyle), className, style)}
    />
  );
}

function MeterTrack({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Track.Props, Restyle<"Meter.Track">>): ReactElement {
  return (
    <MeterPrimitive.Track
      {...rest}
      {...mergeStyleProps(props(styles.track, xstyle), className, style)}
    />
  );
}

function MeterIndicator({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Indicator.Props, Restyle<"Meter.Indicator">>): ReactElement {
  return (
    <MeterPrimitive.Indicator
      {...rest}
      {...mergeStyleProps(props(intent.primary, styles.indicator, xstyle), className, style)}
    />
  );
}

export const Meter = {
  Root: MeterRoot,
  Label: MeterLabel,
  Value: MeterValue,
  Track: MeterTrack,
  Indicator: MeterIndicator,
};
