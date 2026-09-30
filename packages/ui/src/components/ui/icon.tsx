/**
 * One leaf owns Nyte's icon family. Feature components choose a semantic
 * name; they never sketch SVG paths or import individual glyphs.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/icon.tsx
 */
import { create, props } from "@stylexjs/stylex";
import {
  Icon3dBoxTop,
  IconAnalytics,
  IconApps,
  IconArchive1,
  IconArrowCornerDownLeft,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
  IconArrowUp,
  IconArrowWallLeft,
  IconBell,
  IconBlocks,
  IconBolt,
  IconBook,
  IconBranch,
  IconBubbleQuestion,
  IconBug,
  IconBuildingBlocks,
  IconCanvasGrid,
  IconChanges,
  IconCheckmark1,
  IconChevronDownMedium,
  IconChevronRightMedium,
  IconCircleX,
  IconCirclesThree,
  IconClaudeai,
  IconClipboard,
  IconCloudApi,
  IconCloudSimple,
  IconCodeBrackets,
  IconCollaborationPointerRight,
  IconComputerUse,
  IconConsole,
  IconCrossLarge,
  IconCrossSmall,
  IconDevices,
  IconDotGrid1x3HorizontalTight,
  IconDotGrid1x3VerticalTight,
  IconDotGrid2x3,
  IconDraft,
  IconExclamationTriangle,
  IconExpand45,
  IconEyeOpen,
  IconFileText,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
  IconGit,
  IconGithub,
  IconGlobe,
  IconGrok,
  IconInboxChecked,
  IconInboxEmpty,
  IconJavascript,
  IconKey1,
  IconKeyboard,
  IconKimi,
  IconLayersTwo,
  IconLayoutLeftRight,
  IconLayoutTopBottom,
  IconLinear,
  IconListBullets,
  IconLoader,
  IconLock,
  IconMacbook,
  IconMagnifyingGlass,
  IconMerged,
  IconMinimize45,
  IconModelcontextprotocol,
  IconOngoing,
  IconOpenai,
  IconOpencode,
  IconPaperclip1,
  IconPencilLine,
  IconPhone,
  IconPin,
  IconPlusMedium,
  IconPlusSmall,
  IconPullRequest,
  IconPullRequestClosedSimple,
  IconReact,
  IconRobot,
  IconServer,
  IconSettingsGear2,
  IconSettingsSliderHor,
  IconShield,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
  IconSlack,
  IconSparklesSoft,
  IconSquareChecklist,
  IconStop,
  IconTestTube,
  IconTrashCan,
  IconTrending4,
  IconTypescript,
  IconUnarchiv,
  IconUnpin,
  IconUser,
  IconUserKey,
  IconWebsite,
  IconWindowApp,
  IconZai,
} from "central-icons";
import FilledIconMacbook from "central-icons-filled/IconMacbook";
import type { CentralIconBaseProps } from "central-icons/CentralIconBase";
import {
  Icon3dBoxTop as FilledIcon3dBoxTop,
  IconAnalytics as FilledIconAnalytics,
  IconApps as FilledIconApps,
  IconArchive1 as FilledIconArchive1,
  IconArrowCornerDownLeft as FilledIconArrowCornerDownLeft,
  IconArrowDown as FilledIconArrowDown,
  IconArrowLeft as FilledIconArrowLeft,
  IconArrowRight as FilledIconArrowRight,
  IconArrowRotateClockwise as FilledIconArrowRotateClockwise,
  IconArrowUp as FilledIconArrowUp,
  IconArrowWallLeft as FilledIconArrowWallLeft,
  IconBell as FilledIconBell,
  IconBlocks as FilledIconBlocks,
  IconBolt as FilledIconBolt,
  IconBook as FilledIconBook,
  IconBranch as FilledIconBranch,
  IconBubbleQuestion as FilledIconBubbleQuestion,
  IconBug as FilledIconBug,
  IconBuildingBlocks as FilledIconBuildingBlocks,
  IconCanvasGrid as FilledIconCanvasGrid,
  IconChanges as FilledIconChanges,
  IconCheckmark1 as FilledIconCheckmark1,
  IconChevronDownMedium as FilledIconChevronDownMedium,
  IconChevronRightMedium as FilledIconChevronRightMedium,
  IconCircleX as FilledIconCircleX,
  IconCirclesThree as FilledIconCirclesThree,
  IconClaudeai as FilledIconClaudeai,
  IconClipboard as FilledIconClipboard,
  IconCloudApi as FilledIconCloudApi,
  IconCloudSimple as FilledIconCloudSimple,
  IconCodeBrackets as FilledIconCodeBrackets,
  IconCollaborationPointerRight as FilledIconCollaborationPointerRight,
  IconComputerUse as FilledIconComputerUse,
  IconConsole as FilledIconConsole,
  IconCrossLarge as FilledIconCrossLarge,
  IconCrossSmall as FilledIconCrossSmall,
  IconDevices as FilledIconDevices,
  IconDotGrid1x3HorizontalTight as FilledIconDotGrid1x3HorizontalTight,
  IconDotGrid1x3VerticalTight as FilledIconDotGrid1x3VerticalTight,
  IconDotGrid2x3 as FilledIconDotGrid2x3,
  IconDraft as FilledIconDraft,
  IconExclamationTriangle as FilledIconExclamationTriangle,
  IconExpand45 as FilledIconExpand45,
  IconEyeOpen as FilledIconEyeOpen,
  IconFileText as FilledIconFileText,
  IconFolder1 as FilledIconFolder1,
  IconFolderAddRight as FilledIconFolderAddRight,
  IconFolderOpen as FilledIconFolderOpen,
  IconGit as FilledIconGit,
  IconGithub as FilledIconGithub,
  IconGlobe as FilledIconGlobe,
  IconGrok as FilledIconGrok,
  IconInboxChecked as FilledIconInboxChecked,
  IconInboxEmpty as FilledIconInboxEmpty,
  IconJavascript as FilledIconJavascript,
  IconKey1 as FilledIconKey1,
  IconKeyboard as FilledIconKeyboard,
  IconKimi as FilledIconKimi,
  IconLayersTwo as FilledIconLayersTwo,
  IconLayoutLeftRight as FilledIconLayoutLeftRight,
  IconLayoutTopBottom as FilledIconLayoutTopBottom,
  IconLinear as FilledIconLinear,
  IconListBullets as FilledIconListBullets,
  IconLoader as FilledIconLoader,
  IconLock as FilledIconLock,
  IconMagnifyingGlass as FilledIconMagnifyingGlass,
  IconMerged as FilledIconMerged,
  IconMinimize45 as FilledIconMinimize45,
  IconModelcontextprotocol as FilledIconModelcontextprotocol,
  IconOngoing as FilledIconOngoing,
  IconOpenai as FilledIconOpenai,
  IconOpencode as FilledIconOpencode,
  IconPaperclip1 as FilledIconPaperclip1,
  IconPencilLine as FilledIconPencilLine,
  IconPhone as FilledIconPhone,
  IconPin as FilledIconPin,
  IconPlusMedium as FilledIconPlusMedium,
  IconPlusSmall as FilledIconPlusSmall,
  IconPullRequest as FilledIconPullRequest,
  IconPullRequestClosedSimple as FilledIconPullRequestClosedSimple,
  IconReact as FilledIconReact,
  IconRobot as FilledIconRobot,
  IconServer as FilledIconServer,
  IconSettingsGear2 as FilledIconSettingsGear2,
  IconSettingsSliderHor as FilledIconSettingsSliderHor,
  IconShield as FilledIconShield,
  IconSidebarHiddenLeftWide as FilledIconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide as FilledIconSidebarHiddenRightWide,
  IconSlack as FilledIconSlack,
  IconSparklesSoft as FilledIconSparklesSoft,
  IconSquareChecklist as FilledIconSquareChecklist,
  IconStop as FilledIconStop,
  IconTestTube as FilledIconTestTube,
  IconTrashCan as FilledIconTrashCan,
  IconTrending4 as FilledIconTrending4,
  IconTypescript as FilledIconTypescript,
  IconUnarchiv as FilledIconUnarchiv,
  IconUnpin as FilledIconUnpin,
  IconUser as FilledIconUser,
  IconUserKey as FilledIconUserKey,
  IconWebsite as FilledIconWebsite,
  IconWindowApp as FilledIconWindowApp,
  IconZai as FilledIconZai,
} from "central-icons-filled";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from "react";

import { mergeStyleProps, type XStyle } from "../../style.ts";

type Glyph = ComponentType<CentralIconBaseProps>;

export type IconVariant = "outlined" | "filled";

type GlyphPair = Readonly<Record<IconVariant, Glyph>>;

function pair(outlined: Glyph, filled: Glyph): GlyphPair {
  return { outlined, filled };
}

/**
 * Both icon packages export the same component names, so the filled imports
 * carry a `Filled` prefix and each row reads as "semantic name → Central Icons
 * name". Keep the rows sorted by semantic name.
 */
const GLYPHS = {
  apps: pair(IconApps, FilledIconApps),
  archive: pair(IconArchive1, FilledIconArchive1),
  "arrow-down": pair(IconArrowDown, FilledIconArrowDown),
  "arrow-left": pair(IconArrowLeft, FilledIconArrowLeft),
  "arrow-right": pair(IconArrowRight, FilledIconArrowRight),
  "arrow-up": pair(IconArrowUp, FilledIconArrowUp),
  "arrow-wall-left": pair(IconArrowWallLeft, FilledIconArrowWallLeft),
  bell: pair(IconBell, FilledIconBell),
  bolt: pair(IconBolt, FilledIconBolt),
  book: pair(IconBook, FilledIconBook),
  "box-3d": pair(Icon3dBoxTop, FilledIcon3dBoxTop),
  "bubble-question": pair(IconBubbleQuestion, FilledIconBubbleQuestion),
  bug: pair(IconBug, FilledIconBug),
  "canvas-grid": pair(IconCanvasGrid, FilledIconCanvasGrid),
  chart: pair(IconAnalytics, FilledIconAnalytics),
  checkmark: pair(IconCheckmark1, FilledIconCheckmark1),
  "chevron-down": pair(IconChevronDownMedium, FilledIconChevronDownMedium),
  "chevron-right": pair(IconChevronRightMedium, FilledIconChevronRightMedium),
  "circle-x": pair(IconCircleX, FilledIconCircleX),
  circles: pair(IconCirclesThree, FilledIconCirclesThree),
  clock: pair(IconOngoing, FilledIconOngoing),
  close: pair(IconCrossLarge, FilledIconCrossLarge),
  cloud: pair(IconCloudSimple, FilledIconCloudSimple),
  "cloud-api": pair(IconCloudApi, FilledIconCloudApi),
  "code-brackets": pair(IconCodeBrackets, FilledIconCodeBrackets),
  computer: pair(IconComputerUse, FilledIconComputerUse),
  console: pair(IconConsole, FilledIconConsole),
  copy: pair(IconClipboard, FilledIconClipboard),
  customize: pair(IconBlocks, FilledIconBlocks),
  devices: pair(IconDevices, FilledIconDevices),
  "drag-handle": pair(IconDotGrid2x3, FilledIconDotGrid2x3),
  draft: pair(IconDraft, FilledIconDraft),
  expand: pair(IconExpand45, FilledIconExpand45),
  eye: pair(IconEyeOpen, FilledIconEyeOpen),
  file: pair(IconChanges, FilledIconChanges),
  "file-text": pair(IconFileText, FilledIconFileText),
  filters: pair(IconSettingsSliderHor, FilledIconSettingsSliderHor),
  folder: pair(IconFolder1, FilledIconFolder1),
  "folder-add": pair(IconFolderAddRight, FilledIconFolderAddRight),
  "folder-open": pair(IconFolderOpen, FilledIconFolderOpen),
  git: pair(IconGit, FilledIconGit),
  "git-branch": pair(IconBranch, FilledIconBranch),
  github: pair(IconGithub, FilledIconGithub),
  globe: pair(IconGlobe, FilledIconGlobe),
  grok: pair(IconGrok, FilledIconGrok),
  "inbox-checked": pair(IconInboxChecked, FilledIconInboxChecked),
  "inbox-empty": pair(IconInboxEmpty, FilledIconInboxEmpty),
  javascript: pair(IconJavascript, FilledIconJavascript),
  key: pair(IconKey1, FilledIconKey1),
  keyboard: pair(IconKeyboard, FilledIconKeyboard),
  laptop: pair(IconMacbook, FilledIconMacbook),
  layers: pair(IconLayersTwo, FilledIconLayersTwo),
  linear: pair(IconLinear, FilledIconLinear),
  list: pair(IconListBullets, FilledIconListBullets),
  loader: pair(IconLoader, FilledIconLoader),
  lock: pair(IconLock, FilledIconLock),
  mcp: pair(IconModelcontextprotocol, FilledIconModelcontextprotocol),
  merged: pair(IconMerged, FilledIconMerged),
  minimize: pair(IconMinimize45, FilledIconMinimize45),
  "model-anthropic": pair(IconClaudeai, FilledIconClaudeai),
  "model-generic": pair(IconGlobe, FilledIconGlobe),
  "model-kimi": pair(IconKimi, FilledIconKimi),
  "model-openai": pair(IconOpenai, FilledIconOpenai),
  "model-zai": pair(IconZai, FilledIconZai),
  more: pair(IconDotGrid1x3VerticalTight, FilledIconDotGrid1x3VerticalTight),
  "more-horizontal": pair(IconDotGrid1x3HorizontalTight, FilledIconDotGrid1x3HorizontalTight),
  "new-chat": pair(IconCollaborationPointerRight, FilledIconCollaborationPointerRight),
  "new-chat-folder": pair(IconPlusMedium, FilledIconPlusMedium),
  "panel-left": pair(IconSidebarHiddenLeftWide, FilledIconSidebarHiddenLeftWide),
  "panel-right": pair(IconSidebarHiddenRightWide, FilledIconSidebarHiddenRightWide),
  paperclip: pair(IconPaperclip1, FilledIconPaperclip1),
  pencil: pair(IconPencilLine, FilledIconPencilLine),
  phone: pair(IconPhone, FilledIconPhone),
  pin: pair(IconPin, FilledIconPin),
  plus: pair(IconPlusSmall, FilledIconPlusSmall),
  "provider-opencode": pair(IconOpencode, FilledIconOpencode),
  "pull-request": pair(IconPullRequest, FilledIconPullRequest),
  "pull-request-closed": pair(IconPullRequestClosedSimple, FilledIconPullRequestClosedSimple),
  react: pair(IconReact, FilledIconReact),
  refresh: pair(IconArrowRotateClockwise, FilledIconArrowRotateClockwise),
  return: pair(IconArrowCornerDownLeft, FilledIconArrowCornerDownLeft),
  robot: pair(IconRobot, FilledIconRobot),
  search: pair(IconMagnifyingGlass, FilledIconMagnifyingGlass),
  server: pair(IconServer, FilledIconServer),
  settings: pair(IconSettingsGear2, FilledIconSettingsGear2),
  shield: pair(IconShield, FilledIconShield),
  slack: pair(IconSlack, FilledIconSlack),
  skills: pair(IconBuildingBlocks, FilledIconBuildingBlocks),
  sparkle: pair(IconSparklesSoft, FilledIconSparklesSoft),
  "split-down": pair(IconLayoutTopBottom, FilledIconLayoutTopBottom),
  "split-right": pair(IconLayoutLeftRight, FilledIconLayoutLeftRight),
  square: pair(IconStop, FilledIconStop),
  "square-checklist": pair(IconSquareChecklist, FilledIconSquareChecklist),
  "test-tube": pair(IconTestTube, FilledIconTestTube),
  trash: pair(IconTrashCan, FilledIconTrashCan),
  trending: pair(IconTrending4, FilledIconTrending4),
  typescript: pair(IconTypescript, FilledIconTypescript),
  unarchive: pair(IconUnarchiv, FilledIconUnarchiv),
  unpin: pair(IconUnpin, FilledIconUnpin),
  user: pair(IconUser, FilledIconUser),
  "user-key": pair(IconUserKey, FilledIconUserKey),
  warning: pair(IconExclamationTriangle, FilledIconExclamationTriangle),
  website: pair(IconWebsite, FilledIconWebsite),
  "window-app": pair(IconWindowApp, FilledIconWindowApp),
  x: pair(IconCrossSmall, FilledIconCrossSmall),
} satisfies Readonly<Record<string, GlyphPair>>;

export type IconName = keyof typeof GLYPHS;

const styles = create({
  frame: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 0,
  },
});

/**
 * Central Icons draw a 1.5-unit stroke on a 24-unit grid, which renders too
 * thin at the 10–17px sizes the desktop uses. Every frame carries the
 * `data-nyte-icon` hook so an app stylesheet can thicken those strokes;
 * StyleX cannot reach into the glyph's paths itself.
 */
interface IconFrameProps {
  /** Announced to assistive tech. Without it the icon is decorative and hidden. */
  readonly label?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

function IconFrame({ label, children, className, style, xstyle }: IconFrameProps): ReactElement {
  const a11y = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };

  return (
    <span
      {...a11y}
      data-nyte-icon=""
      {...mergeStyleProps(props(styles.frame, xstyle), className, style)}
    >
      {children}
    </span>
  );
}

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly label?: string;
  readonly variant?: IconVariant;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

export function Icon({
  name,
  size = 16,
  label,
  variant = "outlined",
  className,
  style,
  xstyle,
}: IconProps): ReactElement {
  const Glyph = GLYPHS[name][variant];

  return (
    <IconFrame label={label} className={className} style={style} xstyle={xstyle}>
      <Glyph size={size} mode="raw" ariaHidden={true} />
    </IconFrame>
  );
}

export type PanelSide = "left" | "right";

/**
 * Where the panel divider sits on the 24-unit grid. A visible panel draws a
 * full-height divider inside the frame; a hidden one shrinks it and nudges it
 * toward the edge it collapsed into.
 */
const DIVIDER_X: Readonly<Record<PanelSide, Readonly<Record<"visible" | "hidden", number>>>> = {
  left: { visible: 9, hidden: 7 },
  right: { visible: 15, hidden: 17 },
};

// Both paths keep three points so the two shapes can morph into each other.
function panelDividerPath(side: PanelSide, visible: boolean): string {
  const x = String(DIVIDER_X[side][visible ? "visible" : "hidden"]);

  return visible ? `M${x} 5V12V19` : `M${x} 9V12V15`;
}

const PANEL_FRAME_PATH =
  "M3 8C3 6.34 4.34 5 6 5H18C19.66 5 21 6.34 21 8V16C21 17.66 19.66 19 18 19H6C4.34 19 3 17.66 3 16V8Z";

export interface PanelToggleIconProps {
  readonly side: PanelSide;
  readonly visible: boolean;
  readonly size?: number;
}

/**
 * A side-aware panel outline whose divider reflects the current panel state.
 * Only the glyph moves; the panel geometry still changes immediately.
 */
export function PanelToggleIcon({ side, visible, size = 15 }: PanelToggleIconProps): ReactElement {
  const reducedMotion = useReducedMotion();

  return (
    <IconFrame>
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d={PANEL_FRAME_PATH} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        <motion.path
          initial={false}
          animate={{ d: panelDividerPath(side, visible) }}
          transition={
            reducedMotion ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0 }
          }
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap={visible ? undefined : "round"}
          strokeLinejoin="round"
        />
      </svg>
    </IconFrame>
  );
}
