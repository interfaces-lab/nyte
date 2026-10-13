import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { radius } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent } from "./surface-theme.ts";
import { motion, role, type } from "./vars.stylex.ts";

const styles = create({
  root: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  label: { color: role.contentPrimary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  value: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  track: {
    height: 4,
    overflow: "clip",
    borderRadius: radius.indicator,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  // The filled part paints inside the primary intent unless a scope says otherwise.
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
}: StyledProps<MeterPrimitive.Root.Props>): ReactElement {
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
}: StyledProps<MeterPrimitive.Label.Props>): ReactElement {
  return (
    <MeterPrimitive.Label
      {...rest}
      {...mergeStyleProps(props(styles.label, xstyle), className, style)}
    />
  );
}

function MeterValue({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Value.Props>): ReactElement {
  return (
    <MeterPrimitive.Value
      {...rest}
      {...mergeStyleProps(props(styles.value, xstyle), className, style)}
    />
  );
}

function MeterTrack({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<MeterPrimitive.Track.Props>): ReactElement {
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
}: StyledProps<MeterPrimitive.Indicator.Props>): ReactElement {
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
