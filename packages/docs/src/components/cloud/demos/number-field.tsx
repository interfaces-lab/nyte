"use client";

import { NumberField } from "@nyte-ai/ui/number-field";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { IconMinusSmall, IconPlusSmall } from "central-icons";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--nyte-space-1"],
  },
  label: {
    color: colorVars["--nyte-color-muted-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-detail"],
    lineHeight: fontVars["--nyte-leading-detail"],
  },
  group: {
    display: "flex",
    alignItems: "center",
    width: "fit-content",
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-field"],
    backgroundColor: colorVars["--nyte-color-field-background"],
    overflow: "hidden",
  },
  step: {
    display: "grid",
    width: controlVars["--nyte-control-height-md"],
    height: controlVars["--nyte-control-height-md"],
    padding: 0,
    borderStyle: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted"],
    },
    color: colorVars["--nyte-color-foreground"],
    placeItems: "center",
    opacity: { default: 1, ":disabled": controlVars["--nyte-control-disabled-opacity"] },
  },
  input: {
    width: "48px",
    height: controlVars["--nyte-control-height-md"],
    borderStyle: "none",
    backgroundColor: "transparent",
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
    outlineStyle: "none",
  },
});

export function NumberFieldDemo() {
  return (
    <NumberField.Root defaultValue={8} min={1} max={64} step={1} {...stylex.props(styles.root)}>
      <label {...stylex.props(styles.label)} htmlFor="parallel-jobs">
        Parallel jobs
      </label>
      <NumberField.Group {...stylex.props(styles.group)}>
        <NumberField.Decrement aria-label="Decrease" {...stylex.props(styles.step)}>
          <IconMinusSmall size={14} />
        </NumberField.Decrement>
        <NumberField.Input id="parallel-jobs" {...stylex.props(styles.input)} />
        <NumberField.Increment aria-label="Increase" {...stylex.props(styles.step)}>
          <IconPlusSmall size={14} />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}
