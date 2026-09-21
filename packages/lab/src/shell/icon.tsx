import { create, props } from "@stylexjs/stylex";
import {
  IconArchive1,
  IconArrowUp,
  IconBlocks,
  IconChevronRightMedium,
  IconChevronDownMedium,
  IconCheckmark1,
  IconClipboard,
  IconCollaborationPointerRight,
  IconCrossSmall,
  IconDotGrid1x3HorizontalTight,
  IconFolder1,
  IconMagnifyingGlass,
  IconOngoing,
  IconPin,
  IconPlusSmall,
  IconSettingsGear2,
  IconSettingsSliderHor,
  IconTrashCan,
} from "central-icons";
import { space } from "../tokens/space.stylex";

const glyphs = {
  plus: IconPlusSmall,
  search: IconMagnifyingGlass,
  message: IconCollaborationPointerRight,
  history: IconOngoing,
  ellipsis: IconDotGrid1x3HorizontalTight,
  chevron: IconChevronRightMedium,
  chevronDown: IconChevronDownMedium,
  check: IconCheckmark1,
  arrowUp: IconArrowUp,
  folder: IconFolder1,
  copy: IconClipboard,
  trash: IconTrashCan,
  sliders: IconSettingsSliderHor,
  customize: IconBlocks,
  settings: IconSettingsGear2,
  pin: IconPin,
  archive: IconArchive1,
  close: IconCrossSmall,
};

const styles = create({
  glyph: {
    blockSize: space.slotIcon,
    inlineSize: space.slotIcon,
    display: "block",
    flexShrink: 0,
  },
});

export function Icon({ name }: { name: keyof typeof glyphs }) {
  const Glyph = glyphs[name];
  return <Glyph ariaHidden={true} {...props(styles.glyph)} />;
}
