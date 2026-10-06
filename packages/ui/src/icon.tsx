import {
  Icon3dBoxTopDefault,
  IconAnalyticsDefault,
  IconAppsDefault,
  IconArCube3Default,
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
  IconBookDefault,
  IconBrackets2Default,
  IconBranchDefault,
  IconBubbleHeartDefault,
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
  IconDifferenceModifiedDefault,
  IconDraftDefault,
  IconExpand45Default,
  IconEyeOpenDefault,
  IconFileTextDefault,
  IconFolder1Default,
  IconFolderAddRightDefault,
  IconFolderOpenDefault,
  IconGlobeDefault,
  IconImacDefault,
  IconInboxCheckedDefault,
  IconInboxEmptyDefault,
  IconKey1Default,
  IconKeyboardDefault,
  IconLayersTwoDefault,
  IconLayoutLeftRightDefault,
  IconLayoutTopBottomDefault,
  IconListBulletsDefault,
  IconLiveActivityDefault,
  IconLoaderDefault,
  IconLockDefault,
  IconMacbookDefault,
  IconMagnifyingGlassDefault,
  IconMergedDefault,
  IconMinimize45Default,
  IconOngoingDefault,
  IconPaperclip1Default,
  IconPencilLineDefault,
  IconPhoneDefault,
  IconPinDefault,
  IconPlusMediumDefault,
  IconPlusSmallDefault,
  IconPullRequestClosedSimpleDefault,
  IconPullRequestDefault,
  IconRulerDefault,
  IconServerDefault,
  IconSettingsGear2Default,
  IconSettingsSliderHorDefault,
  IconShieldDefault,
  IconSidebarHiddenLeftWideDefault,
  IconSidebarHiddenRightWideDefault,
  IconSparklesSoftDefault,
  IconSpeedLowDefault,
  IconSquareChecklistDefault,
  IconStopDefault,
  IconTestTubeDefault,
  IconTrashCanDefault,
  IconTrending4Default,
  IconUnarchivDefault,
  IconUnpinDefault,
  IconUserDefault,
  IconUserKeyDefault,
  IconWebsiteDefault,
  IconWindowAppDefault,
  IconWritingDefault,
} from "central-icons-filled";
/**
 * One leaf owns Nyte's icon family. Feature components choose a semantic
 * name; they never sketch SVG paths or import individual glyphs.
 */
import { create, props } from "@stylexjs/stylex";
import {
  CentralIconBase,
  type CentralIconBaseProps,
  Icon3dBoxTop,
  IconAnalytics,
  IconApps,
  IconArCube3,
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
  IconBrackets2,
  IconBranch,
  IconBubbleHeart,
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
  IconDifferenceModified,
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
  IconImac,
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
  IconRuler,
  IconServer,
  IconSettingsGear2,
  IconSettingsSliderHor,
  IconShield,
  IconSidebarHiddenLeftWide,
  IconSidebarHiddenRightWide,
  IconSlack,
  IconSparklesSoft,
  IconSpeedLow,
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
  IconVercel,
  IconWebsite,
  IconWindowApp,
  IconWriting,
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

const IconOpenrouter: Glyph = (iconProps) => (
  <CentralIconBase {...iconProps} ariaLabel="openrouter">
    <g transform="scale(0.046875)" fill="currentColor" stroke="currentColor">
      <path
        d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
        strokeWidth={90}
      />
      <path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" />
      <path
        d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
        strokeWidth={90}
      />
      <path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" />
    </g>
  </CentralIconBase>
);

const IconCloudflare: Glyph = (iconProps) => (
  <CentralIconBase {...iconProps} ariaLabel="cloudflare">
    <g transform="translate(0 6.5625) scale(0.09375)" fill="currentColor">
      <path d="M176.332 108.348c1.593-5.31 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.31-11.154-5.842L71.17 87.634c-.531 0-1.062-.53-1.593-.53-.531-.532-.531-1.063 0-1.594.531-1.062 1.062-1.594 2.124-1.594l92.946-1.062c11.154-.53 22.839-9.56 27.087-20.182l5.312-13.809c0-.532.531-1.063 0-1.594C191.203 20.182 166.772 0 138.091 0 111.535 0 88.697 16.995 80.73 40.896c-5.311-3.718-11.684-5.843-19.12-5.31-12.747 1.061-22.838 11.683-24.432 24.43-.531 3.187 0 6.374.532 9.56C16.996 70.107 0 87.103 0 108.348c0 2.124 0 3.718.531 5.842 0 1.063 1.062 1.594 1.594 1.594h170.489c1.062 0 2.125-.53 2.125-1.594l1.593-5.842Z" />
      <path d="M205.544 48.863h-2.656c-.531 0-1.062.53-1.593 1.062l-3.718 12.747c-1.593 5.31-1.062 10.623 1.594 13.809 2.655 3.187 6.373 5.31 11.153 5.843l19.652 1.062c.53 0 1.062.53 1.593.53.53.532.53 1.063 0 1.594-.531 1.063-1.062 1.594-2.125 1.594l-20.182 1.062c-11.154.53-22.838 9.56-27.087 20.182l-1.063 4.78c-.531.532 0 1.594 1.063 1.594h70.108c1.062 0 1.593-.531 1.593-1.593 1.062-4.25 2.124-9.03 2.124-13.81 0-27.618-22.838-50.456-50.456-50.456" />
    </g>
  </CentralIconBase>
);

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
  bolt: pair(IconBolt, IconBolt),
  book: pair(IconBook, IconBookDefault),
  "box-3d": pair(Icon3dBoxTop, Icon3dBoxTopDefault),
  brackets: pair(IconBrackets2, IconBrackets2Default),
  "bubble-heart": pair(IconBubbleHeart, IconBubbleHeartDefault),
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
  cloudflare: pair(IconCloudflare, IconCloudflare),
  "code-brackets": pair(IconCodeBrackets, IconCodeBracketsDefault),
  command: pair(IconCmd, IconCmdDefault),
  computer: pair(IconComputerUse, IconComputerUseDefault),
  console: pair(IconConsole, IconConsoleDefault),
  copy: pair(IconClipboard, IconClipboardDefault),
  cube: pair(IconArCube3, IconArCube3Default),
  customize: pair(IconBlocks, IconBlocksDefault),
  devices: pair(IconDevices, IconDevicesDefault),
  diff: pair(IconDifferenceModified, IconDifferenceModifiedDefault),
  "drag-handle": pair(IconDotGrid2x3, IconDotGrid2x3),
  draft: pair(IconDraft, IconDraftDefault),
  expand: pair(IconExpand45, IconExpand45Default),
  eye: pair(IconEyeOpen, IconEyeOpenDefault),
  file: pair(IconChanges, IconChangesDefault),
  "file-text": pair(IconFileText, IconFileTextDefault),
  filters: pair(IconSettingsSliderHor, IconSettingsSliderHorDefault),
  folder: pair(IconFolder1, IconFolder1Default),
  "folder-add": pair(IconFolderAddRight, IconFolderAddRightDefault),
  "folder-open": pair(IconFolderOpen, IconFolderOpenDefault),
  git: pair(IconGit, IconGit),
  "git-branch": pair(IconBranch, IconBranchDefault),
  github: pair(IconGithub, IconGithub),
  globe: pair(IconGlobe, IconGlobeDefault),
  grok: pair(IconGrok, IconGrok),
  imac: pair(IconImac, IconImacDefault),
  "inbox-checked": pair(IconInboxChecked, IconInboxCheckedDefault),
  "inbox-empty": pair(IconInboxEmpty, IconInboxEmptyDefault),
  javascript: pair(IconJavascript, IconJavascript),
  key: pair(IconKey1, IconKey1Default),
  keyboard: pair(IconKeyboard, IconKeyboardDefault),
  laptop: pair(IconMacbook, IconMacbookDefault),
  layers: pair(IconLayersTwo, IconLayersTwoDefault),
  linear: pair(IconLinear, IconLinear),
  list: pair(IconListBullets, IconListBulletsDefault),
  loader: pair(IconLoader, IconLoaderDefault),
  lock: pair(IconLock, IconLockDefault),
  mcp: pair(IconModelcontextprotocol, IconModelcontextprotocol),
  merged: pair(IconMerged, IconMergedDefault),
  minimize: pair(IconMinimize45, IconMinimize45Default),
  "model-anthropic": pair(IconClaudeai, IconClaudeai),
  "model-generic": pair(IconGlobe, IconGlobeDefault),
  "model-kimi": pair(IconKimi, IconKimi),
  "model-openai": pair(IconOpenai, IconOpenai),
  "model-zai": pair(IconZai, IconZai),
  more: pair(IconDotGrid1x3VerticalTight, IconDotGrid1x3VerticalTight),
  "more-horizontal": pair(IconDotGrid1x3HorizontalTight, IconDotGrid1x3HorizontalTight),
  "new-chat": pair(IconCollaborationPointerRight, IconCollaborationPointerRightDefault),
  "new-chat-folder": pair(IconPlusMedium, IconPlusMediumDefault),
  "panel-left": pair(IconSidebarHiddenLeftWide, IconSidebarHiddenLeftWideDefault),
  "panel-right": pair(IconSidebarHiddenRightWide, IconSidebarHiddenRightWideDefault),
  paperclip: pair(IconPaperclip1, IconPaperclip1Default),
  pencil: pair(IconPencilLine, IconPencilLineDefault),
  phone: pair(IconPhone, IconPhoneDefault),
  pin: pair(IconPin, IconPinDefault),
  plus: pair(IconPlusSmall, IconPlusSmallDefault),
  "provider-opencode": pair(IconOpencode, IconOpencode),
  "provider-openrouter": pair(IconOpenrouter, IconOpenrouter),
  "provider-vercel": pair(IconVercel, IconVercel),
  "pull-request": pair(IconPullRequest, IconPullRequestDefault),
  "pull-request-closed": pair(IconPullRequestClosedSimple, IconPullRequestClosedSimpleDefault),
  react: pair(IconReact, IconReact),
  refresh: pair(IconArrowRotateClockwise, IconArrowRotateClockwiseDefault),
  return: pair(IconArrowCornerDownLeft, IconArrowCornerDownLeftDefault),
  ruler: pair(IconRuler, IconRulerDefault),
  search: pair(IconMagnifyingGlass, IconMagnifyingGlassDefault),
  server: pair(IconServer, IconServerDefault),
  settings: pair(IconSettingsGear2, IconSettingsGear2Default),
  shield: pair(IconShield, IconShieldDefault),
  slack: pair(IconSlack, IconSlack),
  skills: pair(IconBuildingBlocks, IconBuildingBlocksDefault),
  sparkle: pair(IconSparklesSoft, IconSparklesSoftDefault),
  "speed-low": pair(IconSpeedLow, IconSpeedLowDefault),
  "split-down": pair(IconLayoutTopBottom, IconLayoutTopBottomDefault),
  "split-right": pair(IconLayoutLeftRight, IconLayoutLeftRightDefault),
  square: pair(IconStop, IconStopDefault),
  "square-checklist": pair(IconSquareChecklist, IconSquareChecklistDefault),
  status: pair(IconLiveActivity, IconLiveActivityDefault),
  "test-tube": pair(IconTestTube, IconTestTubeDefault),
  trash: pair(IconTrashCan, IconTrashCanDefault),
  trending: pair(IconTrending4, IconTrending4Default),
  typescript: pair(IconTypescript, IconTypescript),
  unarchive: pair(IconUnarchiv, IconUnarchivDefault),
  unpin: pair(IconUnpin, IconUnpinDefault),
  user: pair(IconUser, IconUserDefault),
  "user-key": pair(IconUserKey, IconUserKeyDefault),
  warning: pair(IconBell2Active, IconBell2ActiveDefault),
  website: pair(IconWebsite, IconWebsiteDefault),
  "window-app": pair(IconWindowApp, IconWindowAppDefault),
  writing: pair(IconWriting, IconWritingDefault),
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
