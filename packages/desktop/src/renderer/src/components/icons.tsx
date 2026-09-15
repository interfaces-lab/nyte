/**
 * One leaf owns the desktop's icon family. Feature components choose a
 * semantic name; they never sketch SVG paths or import individual glyphs.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/ui/src/icon.tsx
 */
import * as stylex from "@stylexjs/stylex";
import * as Outlined from "central-icons";
import type { CentralIconBaseProps } from "central-icons/CentralIconBase";
import * as Filled from "central-icons-filled";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentType, ReactElement, ReactNode } from "react";

type Glyph = ComponentType<CentralIconBaseProps>;
type IconVariant = "outlined" | "filled";

type GlyphPair = Readonly<Record<IconVariant, Glyph>>;

function pair(outlined: Glyph, filled: Glyph): GlyphPair {
  return { outlined, filled };
}

/**
 * Both icon packages export the same component names, so each row reads as
 * "semantic name → Central Icons name". Keep the rows sorted by semantic name.
 * Member access on the namespaces stays static so bundlers can tree-shake.
 */
const GLYPHS = {
  apps: pair(Outlined.IconApps, Filled.IconApps),
  archive: pair(Outlined.IconArchive1, Filled.IconArchive1),
  "arrow-left": pair(Outlined.IconArrowLeft, Filled.IconArrowLeft),
  "arrow-right": pair(Outlined.IconArrowRight, Filled.IconArrowRight),
  "arrow-up": pair(Outlined.IconArrowUp, Filled.IconArrowUp),
  "arrow-wall-left": pair(Outlined.IconArrowWallLeft, Filled.IconArrowWallLeft),
  bell: pair(Outlined.IconBell, Filled.IconBell),
  bolt: pair(Outlined.IconBolt, Filled.IconBolt),
  book: pair(Outlined.IconBook, Filled.IconBook),
  "box-3d": pair(Outlined.Icon3dBoxTop, Filled.Icon3dBoxTop),
  "bubble-question": pair(Outlined.IconBubbleQuestion, Filled.IconBubbleQuestion),
  bug: pair(Outlined.IconBug, Filled.IconBug),
  "canvas-grid": pair(Outlined.IconCanvasGrid, Filled.IconCanvasGrid),
  chart: pair(Outlined.IconAnalytics, Filled.IconAnalytics),
  checkmark: pair(Outlined.IconCheckmark1, Filled.IconCheckmark1),
  "chevron-down": pair(Outlined.IconChevronDownMedium, Filled.IconChevronDownMedium),
  "chevron-right": pair(Outlined.IconChevronRightMedium, Filled.IconChevronRightMedium),
  "circle-x": pair(Outlined.IconCircleX, Filled.IconCircleX),
  circles: pair(Outlined.IconCirclesThree, Filled.IconCirclesThree),
  clock: pair(Outlined.IconOngoing, Filled.IconOngoing),
  close: pair(Outlined.IconCrossLarge, Filled.IconCrossLarge),
  cloud: pair(Outlined.IconCloudSimple, Filled.IconCloudSimple),
  "cloud-api": pair(Outlined.IconCloudApi, Filled.IconCloudApi),
  "code-brackets": pair(Outlined.IconCodeBrackets, Filled.IconCodeBrackets),
  computer: pair(Outlined.IconComputerUse, Filled.IconComputerUse),
  console: pair(Outlined.IconConsole, Filled.IconConsole),
  copy: pair(Outlined.IconClipboard, Filled.IconClipboard),
  customize: pair(Outlined.IconBlocks, Filled.IconBlocks),
  devices: pair(Outlined.IconDevices, Filled.IconDevices),
  "drag-handle": pair(Outlined.IconDotGrid2x3, Filled.IconDotGrid2x3),
  draft: pair(Outlined.IconDraft, Filled.IconDraft),
  expand: pair(Outlined.IconExpand45, Filled.IconExpand45),
  eye: pair(Outlined.IconEyeOpen, Filled.IconEyeOpen),
  file: pair(Outlined.IconChanges, Filled.IconChanges),
  "file-text": pair(Outlined.IconFileText, Filled.IconFileText),
  filters: pair(Outlined.IconSettingsSliderHor, Filled.IconSettingsSliderHor),
  folder: pair(Outlined.IconFolder1, Filled.IconFolder1),
  "folder-add": pair(Outlined.IconFolderAddRight, Filled.IconFolderAddRight),
  "folder-open": pair(Outlined.IconFolderOpen, Filled.IconFolderOpen),
  git: pair(Outlined.IconGit, Filled.IconGit),
  "git-branch": pair(Outlined.IconBranch, Filled.IconBranch),
  github: pair(Outlined.IconGithub, Filled.IconGithub),
  globe: pair(Outlined.IconGlobe, Filled.IconGlobe),
  grok: pair(Outlined.IconGrok, Filled.IconGrok),
  "inbox-checked": pair(Outlined.IconInboxChecked, Filled.IconInboxChecked),
  "inbox-empty": pair(Outlined.IconInboxEmpty, Filled.IconInboxEmpty),
  javascript: pair(Outlined.IconJavascript, Filled.IconJavascript),
  key: pair(Outlined.IconKey1, Filled.IconKey1),
  keyboard: pair(Outlined.IconKeyboard, Filled.IconKeyboard),
  layers: pair(Outlined.IconLayersTwo, Filled.IconLayersTwo),
  linear: pair(Outlined.IconLinear, Filled.IconLinear),
  list: pair(Outlined.IconListBullets, Filled.IconListBullets),
  loader: pair(Outlined.IconLoader, Filled.IconLoader),
  lock: pair(Outlined.IconLock, Filled.IconLock),
  mcp: pair(Outlined.IconModelcontextprotocol, Filled.IconModelcontextprotocol),
  merged: pair(Outlined.IconMerged, Filled.IconMerged),
  minimize: pair(Outlined.IconMinimize45, Filled.IconMinimize45),
  "model-anthropic": pair(Outlined.IconClaudeai, Filled.IconClaudeai),
  "model-generic": pair(Outlined.IconGlobe, Filled.IconGlobe),
  "model-kimi": pair(Outlined.IconKimi, Filled.IconKimi),
  "model-openai": pair(Outlined.IconOpenai, Filled.IconOpenai),
  "model-zai": pair(Outlined.IconZai, Filled.IconZai),
  more: pair(Outlined.IconDotGrid1x3VerticalTight, Filled.IconDotGrid1x3VerticalTight),
  "more-horizontal": pair(
    Outlined.IconDotGrid1x3HorizontalTight,
    Filled.IconDotGrid1x3HorizontalTight,
  ),
  "new-chat": pair(Outlined.IconCollaborationPointerRight, Filled.IconCollaborationPointerRight),
  "new-chat-folder": pair(Outlined.IconPlusMedium, Filled.IconPlusMedium),
  "panel-left": pair(Outlined.IconSidebarHiddenLeftWide, Filled.IconSidebarHiddenLeftWide),
  "panel-right": pair(Outlined.IconSidebarHiddenRightWide, Filled.IconSidebarHiddenRightWide),
  paperclip: pair(Outlined.IconPaperclip1, Filled.IconPaperclip1),
  pencil: pair(Outlined.IconPencilLine, Filled.IconPencilLine),
  phone: pair(Outlined.IconPhone, Filled.IconPhone),
  pin: pair(Outlined.IconPin, Filled.IconPin),
  plus: pair(Outlined.IconPlusSmall, Filled.IconPlusSmall),
  "provider-opencode": pair(Outlined.IconOpencode, Filled.IconOpencode),
  "pull-request": pair(Outlined.IconPullRequest, Filled.IconPullRequest),
  "pull-request-closed": pair(
    Outlined.IconPullRequestClosedSimple,
    Filled.IconPullRequestClosedSimple,
  ),
  react: pair(Outlined.IconReact, Filled.IconReact),
  refresh: pair(Outlined.IconArrowRotateClockwise, Filled.IconArrowRotateClockwise),
  robot: pair(Outlined.IconRobot, Filled.IconRobot),
  search: pair(Outlined.IconMagnifyingGlass, Filled.IconMagnifyingGlass),
  settings: pair(Outlined.IconSettingsGear2, Filled.IconSettingsGear2),
  shield: pair(Outlined.IconShield, Filled.IconShield),
  slack: pair(Outlined.IconSlack, Filled.IconSlack),
  skills: pair(Outlined.IconBuildingBlocks, Filled.IconBuildingBlocks),
  sparkle: pair(Outlined.IconSparklesSoft, Filled.IconSparklesSoft),
  "split-down": pair(Outlined.IconLayoutTopBottom, Filled.IconLayoutTopBottom),
  "split-right": pair(Outlined.IconLayoutLeftRight, Filled.IconLayoutLeftRight),
  square: pair(Outlined.IconStop, Filled.IconStop),
  "square-checklist": pair(Outlined.IconSquareChecklist, Filled.IconSquareChecklist),
  "test-tube": pair(Outlined.IconTestTube, Filled.IconTestTube),
  trash: pair(Outlined.IconTrashCan, Filled.IconTrashCan),
  trending: pair(Outlined.IconTrending4, Filled.IconTrending4),
  typescript: pair(Outlined.IconTypescript, Filled.IconTypescript),
  unarchive: pair(Outlined.IconUnarchiv, Filled.IconUnarchiv),
  unpin: pair(Outlined.IconUnpin, Filled.IconUnpin),
  user: pair(Outlined.IconUser, Filled.IconUser),
  "user-key": pair(Outlined.IconUserKey, Filled.IconUserKey),
  warning: pair(Outlined.IconExclamationTriangle, Filled.IconExclamationTriangle),
  website: pair(Outlined.IconWebsite, Filled.IconWebsite),
  "window-app": pair(Outlined.IconWindowApp, Filled.IconWindowApp),
  x: pair(Outlined.IconCrossSmall, Filled.IconCrossSmall),
} satisfies Readonly<Record<string, GlyphPair>>;

export type IconName = keyof typeof GLYPHS;

const styles = stylex.create({
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
 * `data-nyte-icon` hook so the global stylesheet can thicken those strokes;
 * StyleX cannot reach into the glyph's paths itself.
 */
interface IconFrameProps {
  /** Announced to assistive tech. Without it the icon is decorative and hidden. */
  readonly label?: string;
  readonly children: ReactNode;
}

function IconFrame({ label, children }: IconFrameProps): ReactElement {
  const a11y = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <span {...a11y} data-nyte-icon="" {...stylex.props(styles.frame)}>
      {children}
    </span>
  );
}

interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly label?: string;
  readonly variant?: IconVariant;
}

export function Icon({ name, size = 16, label, variant = "outlined" }: IconProps): ReactElement {
  const Glyph = GLYPHS[name][variant];
  return (
    <IconFrame label={label}>
      <Glyph size={size} mode="raw" ariaHidden={true} />
    </IconFrame>
  );
}

type PanelSide = "left" | "right";

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

interface PanelToggleIconProps {
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
