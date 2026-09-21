"use client";

import { Autocomplete } from "@nyte-ai/ui/autocomplete";
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
import * as stylex from "@stylexjs/stylex";
import { IconCrossSmall } from "central-icons";

const models = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-5.2",
  "gemini-3-pro",
];

const styles = stylex.create({
  group: { position: "relative", width: "240px" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: controlVars["--nyte-control-height-md"],
    paddingInlineStart: controlVars["--nyte-control-padding-lg"],
    paddingInlineEnd: controlVars["--nyte-control-menu-inset"],
    paddingBlock: controlVars["--nyte-control-padding-sm"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: {
      default: colorVars["--nyte-color-border"],
      ":focus-visible": colorVars["--nyte-color-ring"],
    },
    borderRadius: radiusVars["--nyte-radius-field"],
    backgroundColor: colorVars["--nyte-color-field-background"],
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    lineHeight: fontVars["--nyte-leading-body"],
    outlineStyle: "none",
    "::placeholder": { color: colorVars["--nyte-color-muted-foreground"] },
  },
  clear: {
    position: "absolute",
    insetInlineEnd: spaceVars["--nyte-space-1"],
    top: "50%",
    display: "grid",
    width: controlVars["--nyte-control-height-sm"],
    height: controlVars["--nyte-control-height-sm"],
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted-hover"],
    },
    color: colorVars["--nyte-color-muted-foreground"],
    placeItems: "center",
    transform: "translateY(-50%)",
  },
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    width: "var(--anchor-width)",
    maxHeight: overlayVars["--nyte-menu-max-height"],
    padding: spaceVars["--nyte-space-1"],
    overflowY: "auto",
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
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-muted-hover"],
    },
    outline: "none",
    userSelect: "none",
  },
  empty: {
    paddingInline: controlVars["--nyte-control-padding-sm"],
    paddingBlock: spaceVars["--nyte-space-1"],
    color: colorVars["--nyte-color-muted-foreground"],
    fontSize: fontVars["--nyte-font-size-detail"],
  },
});

export function AutocompleteDemo() {
  return (
    <Autocomplete.Root items={models}>
      <Autocomplete.InputGroup {...stylex.props(styles.group)}>
        <Autocomplete.Input
          placeholder="Search models"
          aria-label="Search models"
          {...stylex.props(styles.input)}
        />
        <Autocomplete.Clear aria-label="Clear" {...stylex.props(styles.clear)}>
          <IconCrossSmall size={12} />
        </Autocomplete.Clear>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} {...stylex.props(styles.positioner)}>
          <Autocomplete.Popup {...stylex.props(styles.popup)}>
            <Autocomplete.Empty {...stylex.props(styles.empty)}>No models match</Autocomplete.Empty>
            <Autocomplete.List>
              {(model: string) => (
                <Autocomplete.Item key={model} value={model} {...stylex.props(styles.item)}>
                  {model}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
