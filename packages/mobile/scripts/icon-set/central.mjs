/** Central Icons for the iOS completion glyphs; selected by scripts/icons.mjs when installed. */
import { createElement } from "react";
import { IconBuildingBlocks } from "central-icons/IconBuildingBlocks";
import { IconChanges } from "central-icons/IconChanges";
import { IconCmd } from "central-icons/IconCmd";
import { IconFolder1 } from "central-icons/IconFolder1";

const central = (icon) => () => createElement(icon, { mode: "raw", ariaHidden: true });

export const glyphs = {
  file: central(IconChanges),
  folder: central(IconFolder1),
  command: central(IconCmd),
  skill: central(IconBuildingBlocks),
};
