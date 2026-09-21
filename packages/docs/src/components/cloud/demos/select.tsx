"use client";

import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  overlayVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Select } from "@nyte-ai/ui/select";
import * as stylex from "@stylexjs/stylex";
import { IconCheckmark1Small, IconChevronGrabberVertical } from "central-icons";

const themes = [
  { value: "system", label: "System default" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: spaceVars["--nyte-space-1"] },
  label: {
    color: colorVars["--nyte-color-muted-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-detail"],
    lineHeight: fontVars["--nyte-leading-detail"],
  },
  trigger: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "200px",
    height: controlVars["--nyte-control-height-md"],
    gap: spaceVars["--nyte-space-2"],
    paddingInline: controlVars["--nyte-control-padding-lg"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-field"],
    backgroundColor: {
      default: colorVars["--nyte-color-field-background"],
      ":hover": colorVars["--nyte-color-muted"],
    },
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
  },
  icon: { flexShrink: 0, color: colorVars["--nyte-color-muted-foreground"] },
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    minWidth: "var(--anchor-width)",
    padding: spaceVars["--nyte-space-1"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    backgroundColor: colorVars["--nyte-color-popover"],
    boxShadow: elevationVars["--nyte-elevation-menu"],
    color: colorVars["--nyte-color-popover-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
    outline: "none",
  },
  item: {
    display: "flex",
    alignItems: "center",
    minHeight: controlVars["--nyte-control-height-md"],
    gap: spaceVars["--nyte-space-2"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-muted-hover"],
    },
    outline: "none",
    userSelect: "none",
  },
  indicator: { marginInlineStart: "auto" },
});

export function SelectDemo() {
  return (
    <Select.Root items={themes} defaultValue="system">
      <div {...stylex.props(styles.root)}>
        <Select.Label {...stylex.props(styles.label)}>Theme</Select.Label>
        <Select.Trigger {...stylex.props(styles.trigger)}>
          <Select.Value />
          <Select.Icon {...stylex.props(styles.icon)}>
            <IconChevronGrabberVertical size={12} />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner {...stylex.props(styles.positioner)}>
          <Select.Popup {...stylex.props(styles.popup)}>
            <Select.List>
              {themes.map((theme) => (
                <Select.Item key={theme.value} value={theme.value} {...stylex.props(styles.item)}>
                  <Select.ItemText>{theme.label}</Select.ItemText>
                  <Select.ItemIndicator {...stylex.props(styles.indicator)}>
                    <IconCheckmark1Small size={12} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
