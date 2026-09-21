"use client";

import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Slider } from "@nyte-ai/ui/slider";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "260px",
    gap: spaceVars["--nyte-space-2"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
  },
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  label: { color: colorVars["--nyte-color-foreground"] },
  value: {
    color: colorVars["--nyte-color-muted-foreground"],
    fontVariantNumeric: "tabular-nums",
  },
  control: {
    display: "flex",
    alignItems: "center",
    height: controlVars["--nyte-control-height-sm"],
  },
  track: {
    position: "relative",
    width: "100%",
    height: spaceVars["--nyte-space-1"],
    borderRadius: radiusVars["--nyte-radius-pill"],
    backgroundColor: colorVars["--nyte-color-muted"],
  },
  indicator: {
    height: "100%",
    borderRadius: radiusVars["--nyte-radius-pill"],
    backgroundColor: colorVars["--nyte-color-primary"],
  },
  thumb: {
    width: spaceVars["--nyte-space-4"],
    height: spaceVars["--nyte-space-4"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-pill"],
    backgroundColor: colorVars["--nyte-color-raised"],
    boxShadow: elevationVars["--nyte-elevation-field"],
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
  },
});

export function SliderDemo() {
  return (
    <Slider.Root defaultValue={0.7} min={0} max={1} step={0.1} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.header)}>
        <Slider.Label {...stylex.props(styles.label)}>Temperature</Slider.Label>
        <Slider.Value {...stylex.props(styles.value)} />
      </div>
      <Slider.Control {...stylex.props(styles.control)}>
        <Slider.Track {...stylex.props(styles.track)}>
          <Slider.Indicator {...stylex.props(styles.indicator)} />
          <Slider.Thumb {...stylex.props(styles.thumb)} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
