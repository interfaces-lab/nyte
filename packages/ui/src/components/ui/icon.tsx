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
import FilledIcon3dBoxTop from "central-icons-filled/Icon3dBoxTop";
import FilledIconAnalytics from "central-icons-filled/IconAnalytics";
import FilledIconApps from "central-icons-filled/IconApps";
import FilledIconArchive1 from "central-icons-filled/IconArchive1";
import FilledIconArrowCornerDownLeft from "central-icons-filled/IconArrowCornerDownLeft";
import FilledIconArrowDown from "central-icons-filled/IconArrowDown";
import FilledIconArrowLeft from "central-icons-filled/IconArrowLeft";
import FilledIconArrowRight from "central-icons-filled/IconArrowRight";
import FilledIconArrowRotateClockwise from "central-icons-filled/IconArrowRotateClockwise";
import FilledIconArrowUp from "central-icons-filled/IconArrowUp";
import FilledIconArrowWallLeft from "central-icons-filled/IconArrowWallLeft";
import FilledIconBell from "central-icons-filled/IconBell";
import FilledIconBlocks from "central-icons-filled/IconBlocks";
import FilledIconBolt from "central-icons-filled/IconBolt";
import FilledIconBook from "central-icons-filled/IconBook";
import FilledIconBranch from "central-icons-filled/IconBranch";
import FilledIconBubbleQuestion from "central-icons-filled/IconBubbleQuestion";
import FilledIconBug from "central-icons-filled/IconBug";
import FilledIconBuildingBlocks from "central-icons-filled/IconBuildingBlocks";
import FilledIconCanvasGrid from "central-icons-filled/IconCanvasGrid";
import FilledIconChanges from "central-icons-filled/IconChanges";
import FilledIconCheckmark1 from "central-icons-filled/IconCheckmark1";
import FilledIconChevronDownMedium from "central-icons-filled/IconChevronDownMedium";
import FilledIconChevronRightMedium from "central-icons-filled/IconChevronRightMedium";
import FilledIconCircleX from "central-icons-filled/IconCircleX";
import FilledIconCirclesThree from "central-icons-filled/IconCirclesThree";
import FilledIconClaudeai from "central-icons-filled/IconClaudeai";
import FilledIconClipboard from "central-icons-filled/IconClipboard";
import FilledIconCloudApi from "central-icons-filled/IconCloudApi";
import FilledIconCloudSimple from "central-icons-filled/IconCloudSimple";
import FilledIconCodeBrackets from "central-icons-filled/IconCodeBrackets";
import FilledIconCollaborationPointerRight from "central-icons-filled/IconCollaborationPointerRight";
import FilledIconComputerUse from "central-icons-filled/IconComputerUse";
import FilledIconConsole from "central-icons-filled/IconConsole";
import FilledIconCrossLarge from "central-icons-filled/IconCrossLarge";
import FilledIconCrossSmall from "central-icons-filled/IconCrossSmall";
import FilledIconDevices from "central-icons-filled/IconDevices";
import FilledIconDotGrid1x3HorizontalTight from "central-icons-filled/IconDotGrid1x3HorizontalTight";
import FilledIconDotGrid1x3VerticalTight from "central-icons-filled/IconDotGrid1x3VerticalTight";
import FilledIconDotGrid2x3 from "central-icons-filled/IconDotGrid2x3";
import FilledIconDraft from "central-icons-filled/IconDraft";
import FilledIconExclamationTriangle from "central-icons-filled/IconExclamationTriangle";
import FilledIconExpand45 from "central-icons-filled/IconExpand45";
import FilledIconEyeOpen from "central-icons-filled/IconEyeOpen";
import FilledIconFileText from "central-icons-filled/IconFileText";
import FilledIconFolder1 from "central-icons-filled/IconFolder1";
import FilledIconFolderAddRight from "central-icons-filled/IconFolderAddRight";
import FilledIconFolderOpen from "central-icons-filled/IconFolderOpen";
import FilledIconGit from "central-icons-filled/IconGit";
import FilledIconGithub from "central-icons-filled/IconGithub";
import FilledIconGlobe from "central-icons-filled/IconGlobe";
import FilledIconGrok from "central-icons-filled/IconGrok";
import FilledIconInboxChecked from "central-icons-filled/IconInboxChecked";
import FilledIconInboxEmpty from "central-icons-filled/IconInboxEmpty";
import FilledIconJavascript from "central-icons-filled/IconJavascript";
import FilledIconKey1 from "central-icons-filled/IconKey1";
import FilledIconKeyboard from "central-icons-filled/IconKeyboard";
import FilledIconKimi from "central-icons-filled/IconKimi";
import FilledIconLayersTwo from "central-icons-filled/IconLayersTwo";
import FilledIconLayoutLeftRight from "central-icons-filled/IconLayoutLeftRight";
import FilledIconLayoutTopBottom from "central-icons-filled/IconLayoutTopBottom";
import FilledIconLinear from "central-icons-filled/IconLinear";
import FilledIconListBullets from "central-icons-filled/IconListBullets";
import FilledIconLoader from "central-icons-filled/IconLoader";
import FilledIconLock from "central-icons-filled/IconLock";
import FilledIconMagnifyingGlass from "central-icons-filled/IconMagnifyingGlass";
import FilledIconMerged from "central-icons-filled/IconMerged";
import FilledIconMinimize45 from "central-icons-filled/IconMinimize45";
import FilledIconModelcontextprotocol from "central-icons-filled/IconModelcontextprotocol";
import FilledIconOngoing from "central-icons-filled/IconOngoing";
import FilledIconOpenai from "central-icons-filled/IconOpenai";
import FilledIconOpencode from "central-icons-filled/IconOpencode";
import FilledIconPaperclip1 from "central-icons-filled/IconPaperclip1";
import FilledIconPencilLine from "central-icons-filled/IconPencilLine";
import FilledIconPhone from "central-icons-filled/IconPhone";
import FilledIconPin from "central-icons-filled/IconPin";
import FilledIconPlusMedium from "central-icons-filled/IconPlusMedium";
import FilledIconPlusSmall from "central-icons-filled/IconPlusSmall";
import FilledIconPullRequest from "central-icons-filled/IconPullRequest";
import FilledIconPullRequestClosedSimple from "central-icons-filled/IconPullRequestClosedSimple";
import FilledIconReact from "central-icons-filled/IconReact";
import FilledIconRobot from "central-icons-filled/IconRobot";
import FilledIconServer from "central-icons-filled/IconServer";
import FilledIconSettingsGear2 from "central-icons-filled/IconSettingsGear2";
import FilledIconSettingsSliderHor from "central-icons-filled/IconSettingsSliderHor";
import FilledIconShield from "central-icons-filled/IconShield";
import FilledIconSidebarHiddenLeftWide from "central-icons-filled/IconSidebarHiddenLeftWide";
import FilledIconSidebarHiddenRightWide from "central-icons-filled/IconSidebarHiddenRightWide";
import FilledIconSlack from "central-icons-filled/IconSlack";
import FilledIconSparklesSoft from "central-icons-filled/IconSparklesSoft";
import FilledIconSquareChecklist from "central-icons-filled/IconSquareChecklist";
import FilledIconStop from "central-icons-filled/IconStop";
import FilledIconTestTube from "central-icons-filled/IconTestTube";
import FilledIconTrashCan from "central-icons-filled/IconTrashCan";
import FilledIconTrending4 from "central-icons-filled/IconTrending4";
import FilledIconTypescript from "central-icons-filled/IconTypescript";
import FilledIconUnarchiv from "central-icons-filled/IconUnarchiv";
import FilledIconUnpin from "central-icons-filled/IconUnpin";
import FilledIconUser from "central-icons-filled/IconUser";
import FilledIconUserKey from "central-icons-filled/IconUserKey";
import FilledIconWebsite from "central-icons-filled/IconWebsite";
import FilledIconWindowApp from "central-icons-filled/IconWindowApp";
import FilledIconZai from "central-icons-filled/IconZai";
import { motion, useReducedMotion } from "motion/react";
import {
  createContext,
  use,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

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
