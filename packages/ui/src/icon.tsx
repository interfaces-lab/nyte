import {
  Icon3dBoxTopDefault,
  IconAnalyticsDefault,
  IconAppsDefault,
  IconArchive1Default,
  IconArrowCornerDownLeftDefault,
  IconArrowDownDefault,
  IconArrowLeftDefault,
  IconArrowRightDefault,
  IconArrowRotateClockwiseDefault,
  IconArrowUpDefault,
  IconArrowWallLeftDefault,
  IconBell2ActiveDefault,
  IconBellDefault,
  IconBlocksDefault,
  IconBoltDefault,
  IconBookDefault,
  IconBranchDefault,
  IconBubbleQuestionDefault,
  IconBugDefault,
  IconBuildingBlocksDefault,
  IconCanvasGridDefault,
  IconChangesDefault,
  IconCheckmark1MediumDefault,
  IconChevronDownMediumDefault,
  IconChevronGrabberVerticalDefault,
  IconChevronRightMediumDefault,
  IconCircleXDefault,
  IconCirclesThreeDefault,
  IconClaudeaiDefault,
  IconClipboardDefault,
  IconCloudApiDefault,
  IconCloudSimpleDefault,
  IconCmdDefault,
  IconCodeBracketsDefault,
  IconCollaborationPointerRightDefault,
  IconComputerUseDefault,
  IconConsoleDefault,
  IconCrossLargeDefault,
  IconCrossSmallDefault,
  IconCursorAiDefault,
  IconDevicesDefault,
  IconDotGrid1x3HorizontalTightDefault,
  IconDotGrid1x3VerticalTightDefault,
  IconDotGrid2x3Default,
  IconDraftDefault,
  IconExpand45Default,
  IconEyeOpenDefault,
  IconFileTextDefault,
  IconFolder1Default,
  IconFolderAddRightDefault,
  IconFolderOpenDefault,
  IconGitDefault,
  IconGithubDefault,
  IconGlobeDefault,
  IconGrokDefault,
  IconInboxCheckedDefault,
  IconInboxEmptyDefault,
  IconJavascriptDefault,
  IconKey1Default,
  IconKeyboardDefault,
  IconKimiDefault,
  IconLayersTwoDefault,
  IconLayoutLeftRightDefault,
  IconLayoutTopBottomDefault,
  IconLinearDefault,
  IconListBulletsDefault,
  IconLiveActivityDefault,
  IconLoaderDefault,
  IconLockDefault,
  IconMacbookDefault,
  IconMagnifyingGlassDefault,
  IconMergedDefault,
  IconMinimize45Default,
  IconModelcontextprotocolDefault,
  IconOngoingDefault,
  IconOpenaiDefault,
  IconOpencodeDefault,
  IconPaperclip1Default,
  IconPencilLineDefault,
  IconPhoneDefault,
  IconPinDefault,
  IconPlusMediumDefault,
  IconPlusSmallDefault,
  IconPullRequestClosedSimpleDefault,
  IconPullRequestDefault,
  IconReactDefault,
  IconServerDefault,
  IconSettingsGear2Default,
  IconSettingsSliderHorDefault,
  IconShieldDefault,
  IconSidebarHiddenLeftWideDefault,
  IconSidebarHiddenRightWideDefault,
  IconSlackDefault,
  IconSparklesSoftDefault,
  IconSquareChecklistDefault,
  IconStopDefault,
  IconTestTubeDefault,
  IconTrashCanDefault,
  IconTrending4Default,
  IconTypescriptDefault,
  IconUnarchivDefault,
  IconUnpinDefault,
  IconUserDefault,
  IconUserKeyDefault,
  IconWebsiteDefault,
  IconWindowAppDefault,
  IconZaiDefault,
} from "central-icons-filled";
/**
 * One leaf owns Nyte's icon family. Feature components choose a semantic
 * name; they never sketch SVG paths or import individual glyphs.
 */
import { create, props } from "@stylexjs/stylex";
import {
  type CentralIconBaseProps,
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
  IconBell2Active,
  IconBlocks,
  IconBolt,
  IconBook,
  IconBranch,
  IconBubbleQuestion,
  IconBug,
  IconBuildingBlocks,
  IconCanvasGrid,
  IconChanges,
  IconCheckmark1Medium,
  IconChevronDownMedium,
  IconChevronGrabberVertical,
  IconChevronRightMedium,
  IconCircleX,
  IconCirclesThree,
  IconClaudeai,
  IconClipboard,
  IconCloudApi,
  IconCloudSimple,
  IconCmd,
  IconCodeBrackets,
  IconCollaborationPointerRight,
  IconComputerUse,
  IconConsole,
  IconCrossLarge,
  IconCrossSmall,
  IconCursorAi,
  IconDevices,
  IconDotGrid1x3HorizontalTight,
  IconDotGrid1x3VerticalTight,
  IconDotGrid2x3,
  IconDraft,
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
  IconLiveActivity,
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
import { motion, useReducedMotion } from "motion/react";
import {
  createContext,
  use,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { mergeStyleProps, type XStyle } from "./style.ts";

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
  agent: pair(IconCursorAi, IconCursorAiDefault),
  apps: pair(IconApps, IconAppsDefault),
  archive: pair(IconArchive1, IconArchive1Default),
  "arrow-down": pair(IconArrowDown, IconArrowDownDefault),
  "arrow-left": pair(IconArrowLeft, IconArrowLeftDefault),
  "arrow-right": pair(IconArrowRight, IconArrowRightDefault),
  "arrow-up": pair(IconArrowUp, IconArrowUpDefault),
  "arrow-wall-left": pair(IconArrowWallLeft, IconArrowWallLeftDefault),
  bell: pair(IconBell, IconBellDefault),
  bolt: pair(IconBolt, IconBoltDefault),
  book: pair(IconBook, IconBookDefault),
  "box-3d": pair(Icon3dBoxTop, Icon3dBoxTopDefault),
  "bubble-question": pair(IconBubbleQuestion, IconBubbleQuestionDefault),
  bug: pair(IconBug, IconBugDefault),
  "canvas-grid": pair(IconCanvasGrid, IconCanvasGridDefault),
  chart: pair(IconAnalytics, IconAnalyticsDefault),
  checkmark: pair(IconCheckmark1Medium, IconCheckmark1MediumDefault),
  "chevron-down": pair(IconChevronDownMedium, IconChevronDownMediumDefault),
  "chevron-right": pair(IconChevronRightMedium, IconChevronRightMediumDefault),
  "chevron-up-down": pair(IconChevronGrabberVertical, IconChevronGrabberVerticalDefault),
  "circle-x": pair(IconCircleX, IconCircleXDefault),
  circles: pair(IconCirclesThree, IconCirclesThreeDefault),
  clock: pair(IconOngoing, IconOngoingDefault),
  close: pair(IconCrossLarge, IconCrossLargeDefault),
  cloud: pair(IconCloudSimple, IconCloudSimpleDefault),
  "cloud-api": pair(IconCloudApi, IconCloudApiDefault),
  "code-brackets": pair(IconCodeBrackets, IconCodeBracketsDefault),
  command: pair(IconCmd, IconCmdDefault),
  computer: pair(IconComputerUse, IconComputerUseDefault),
  console: pair(IconConsole, IconConsoleDefault),
  copy: pair(IconClipboard, IconClipboardDefault),
  customize: pair(IconBlocks, IconBlocksDefault),
  devices: pair(IconDevices, IconDevicesDefault),
  "drag-handle": pair(IconDotGrid2x3, IconDotGrid2x3Default),
  draft: pair(IconDraft, IconDraftDefault),
  expand: pair(IconExpand45, IconExpand45Default),
  eye: pair(IconEyeOpen, IconEyeOpenDefault),
  file: pair(IconChanges, IconChangesDefault),
  "file-text": pair(IconFileText, IconFileTextDefault),
  filters: pair(IconSettingsSliderHor, IconSettingsSliderHorDefault),
  folder: pair(IconFolder1, IconFolder1Default),
  "folder-add": pair(IconFolderAddRight, IconFolderAddRightDefault),
  "folder-open": pair(IconFolderOpen, IconFolderOpenDefault),
  git: pair(IconGit, IconGitDefault),
  "git-branch": pair(IconBranch, IconBranchDefault),
  github: pair(IconGithub, IconGithubDefault),
  globe: pair(IconGlobe, IconGlobeDefault),
  grok: pair(IconGrok, IconGrokDefault),
  "inbox-checked": pair(IconInboxChecked, IconInboxCheckedDefault),
  "inbox-empty": pair(IconInboxEmpty, IconInboxEmptyDefault),
  javascript: pair(IconJavascript, IconJavascriptDefault),
  key: pair(IconKey1, IconKey1Default),
  keyboard: pair(IconKeyboard, IconKeyboardDefault),
  laptop: pair(IconMacbook, IconMacbookDefault),
  layers: pair(IconLayersTwo, IconLayersTwoDefault),
  linear: pair(IconLinear, IconLinearDefault),
  list: pair(IconListBullets, IconListBulletsDefault),
  loader: pair(IconLoader, IconLoaderDefault),
  lock: pair(IconLock, IconLockDefault),
  mcp: pair(IconModelcontextprotocol, IconModelcontextprotocolDefault),
  merged: pair(IconMerged, IconMergedDefault),
  minimize: pair(IconMinimize45, IconMinimize45Default),
  "model-anthropic": pair(IconClaudeai, IconClaudeaiDefault),
  "model-generic": pair(IconGlobe, IconGlobeDefault),
  "model-kimi": pair(IconKimi, IconKimiDefault),
  "model-openai": pair(IconOpenai, IconOpenaiDefault),
  "model-zai": pair(IconZai, IconZaiDefault),
  more: pair(IconDotGrid1x3VerticalTight, IconDotGrid1x3VerticalTightDefault),
  "more-horizontal": pair(IconDotGrid1x3HorizontalTight, IconDotGrid1x3HorizontalTightDefault),
  "new-chat": pair(IconCollaborationPointerRight, IconCollaborationPointerRightDefault),
  "new-chat-folder": pair(IconPlusMedium, IconPlusMediumDefault),
  "panel-left": pair(IconSidebarHiddenLeftWide, IconSidebarHiddenLeftWideDefault),
  "panel-right": pair(IconSidebarHiddenRightWide, IconSidebarHiddenRightWideDefault),
  paperclip: pair(IconPaperclip1, IconPaperclip1Default),
  pencil: pair(IconPencilLine, IconPencilLineDefault),
  phone: pair(IconPhone, IconPhoneDefault),
  pin: pair(IconPin, IconPinDefault),
  plus: pair(IconPlusSmall, IconPlusSmallDefault),
  "provider-opencode": pair(IconOpencode, IconOpencodeDefault),
  "pull-request": pair(IconPullRequest, IconPullRequestDefault),
  "pull-request-closed": pair(IconPullRequestClosedSimple, IconPullRequestClosedSimpleDefault),
  react: pair(IconReact, IconReactDefault),
  refresh: pair(IconArrowRotateClockwise, IconArrowRotateClockwiseDefault),
  return: pair(IconArrowCornerDownLeft, IconArrowCornerDownLeftDefault),
  search: pair(IconMagnifyingGlass, IconMagnifyingGlassDefault),
  server: pair(IconServer, IconServerDefault),
  settings: pair(IconSettingsGear2, IconSettingsGear2Default),
  shield: pair(IconShield, IconShieldDefault),
  slack: pair(IconSlack, IconSlackDefault),
  skills: pair(IconBuildingBlocks, IconBuildingBlocksDefault),
  sparkle: pair(IconSparklesSoft, IconSparklesSoftDefault),
  "split-down": pair(IconLayoutTopBottom, IconLayoutTopBottomDefault),
  "split-right": pair(IconLayoutLeftRight, IconLayoutLeftRightDefault),
  square: pair(IconStop, IconStopDefault),
  "square-checklist": pair(IconSquareChecklist, IconSquareChecklistDefault),
  status: pair(IconLiveActivity, IconLiveActivityDefault),
  "test-tube": pair(IconTestTube, IconTestTubeDefault),
  trash: pair(IconTrashCan, IconTrashCanDefault),
  trending: pair(IconTrending4, IconTrending4Default),
  typescript: pair(IconTypescript, IconTypescriptDefault),
  unarchive: pair(IconUnarchiv, IconUnarchivDefault),
  unpin: pair(IconUnpin, IconUnpinDefault),
  user: pair(IconUser, IconUserDefault),
  "user-key": pair(IconUserKey, IconUserKeyDefault),
  warning: pair(IconBell2Active, IconBell2ActiveDefault),
  website: pair(IconWebsite, IconWebsiteDefault),
  "window-app": pair(IconWindowApp, IconWindowAppDefault),
  x: pair(IconCrossSmall, IconCrossSmallDefault),
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

const ControlGlyphContext = createContext(false);

export function ControlGlyphs({ children }: { readonly children: ReactNode }): ReactElement {
  return <ControlGlyphContext value={true}>{children}</ControlGlyphContext>;
}

interface IconFrameProps {
  /** Announced to assistive tech. Without it the icon is decorative and hidden. */
  readonly label?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

function IconFrame({ label, children, className, style, xstyle }: IconFrameProps): ReactElement {
  const controlled = use(ControlGlyphContext);
  const a11y = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  const frame = mergeStyleProps(props(styles.frame, xstyle), className, style);

  return (
    <span
      {...a11y}
      data-nyte-icon=""
      {...frame}
      style={controlled ? { ...frame.style, color: "inherit", opacity: 1 } : frame.style}
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
  left: { visible: 9, hidden: 6.25 },
  right: { visible: 15, hidden: 17.75 },
};

// Both paths keep three points so the two shapes can morph into each other.
function panelDividerPath(side: PanelSide, visible: boolean): string {
  const x = String(DIVIDER_X[side][visible ? "visible" : "hidden"]);

  return visible ? `M${x} 4.75V12V19.25` : `M${x} 8.25V12V15.75`;
}

const PANEL_FRAME_PATH =
  "M2.75 6.75C2.75 5.64543 3.64543 4.75 4.75 4.75H19.25C20.3546 4.75 21.25 5.64543 21.25 6.75V17.25C21.25 18.3546 20.3546 19.25 19.25 19.25H4.75C3.64543 19.25 2.75 18.3546 2.75 17.25V6.75Z";

export interface PanelToggleIconProps {
  readonly side: PanelSide;
  readonly visible: boolean;
  readonly size?: number;
}

/**
 * A side-aware panel outline whose divider reflects the current panel state.
 * Only the glyph moves; the panel geometry still changes immediately.
 */
export function PanelToggleIcon({ side, visible, size = 16 }: PanelToggleIconProps): ReactElement {
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
