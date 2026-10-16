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
import { IconBell2ActiveDefault, IconBubbleQuestionDefault } from "central-icons-filled";
import { motion, useReducedMotion } from "motion/react";
import {
  createContext,
  use,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { mergeStyleProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";

type Glyph = ComponentType<CentralIconBaseProps>;

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

/** Each row reads as "semantic name → Central Icons name". Keep the rows sorted by semantic name. */
const GLYPHS = {
  agent: IconCursorAi,
  apps: IconApps,
  archive: IconArchive1,
  "arrow-down": IconArrowDown,
  "arrow-left": IconArrowLeft,
  "arrow-right": IconArrowRight,
  "arrow-up": IconArrowUp,
  "arrow-wall-left": IconArrowWallLeft,
  bell: IconBell,
  bolt: IconBolt,
  book: IconBook,
  "box-3d": Icon3dBoxTop,
  brackets: IconBrackets2,
  "bubble-heart": IconBubbleHeart,
  "bubble-question": IconBubbleQuestion,
  bug: IconBug,
  "canvas-grid": IconCanvasGrid,
  chart: IconAnalytics,
  checkmark: IconCheckmark1Medium,
  "chevron-down": IconChevronDownMedium,
  "chevron-right": IconChevronRightMedium,
  "chevron-up-down": IconChevronGrabberVertical,
  "circle-x": IconCircleX,
  circles: IconCirclesThree,
  clock: IconOngoing,
  close: IconCrossLarge,
  cloud: IconCloudSimple,
  "cloud-api": IconCloudApi,
  cloudflare: IconCloudflare,
  "code-brackets": IconCodeBrackets,
  command: IconCmd,
  computer: IconComputerUse,
  console: IconConsole,
  copy: IconClipboard,
  cube: IconArCube3,
  customize: IconBlocks,
  devices: IconDevices,
  diff: IconDifferenceModified,
  "drag-handle": IconDotGrid2x3,
  draft: IconDraft,
  expand: IconExpand45,
  eye: IconEyeOpen,
  file: IconChanges,
  "file-text": IconFileText,
  filters: IconSettingsSliderHor,
  folder: IconFolder1,
  "folder-add": IconFolderAddRight,
  "folder-open": IconFolderOpen,
  git: IconGit,
  "git-branch": IconBranch,
  github: IconGithub,
  globe: IconGlobe,
  grok: IconGrok,
  imac: IconImac,
  "inbox-checked": IconInboxChecked,
  "inbox-empty": IconInboxEmpty,
  javascript: IconJavascript,
  key: IconKey1,
  keyboard: IconKeyboard,
  laptop: IconMacbook,
  layers: IconLayersTwo,
  linear: IconLinear,
  list: IconListBullets,
  loader: IconLoader,
  lock: IconLock,
  mcp: IconModelcontextprotocol,
  merged: IconMerged,
  minimize: IconMinimize45,
  "model-anthropic": IconClaudeai,
  "model-generic": IconGlobe,
  "model-kimi": IconKimi,
  "model-openai": IconOpenai,
  "model-zai": IconZai,
  more: IconDotGrid1x3VerticalTight,
  "more-horizontal": IconDotGrid1x3HorizontalTight,
  "new-chat": IconCollaborationPointerRight,
  "new-chat-folder": IconPlusMedium,
  "panel-left": IconSidebarHiddenLeftWide,
  "panel-right": IconSidebarHiddenRightWide,
  paperclip: IconPaperclip1,
  pencil: IconPencilLine,
  phone: IconPhone,
  pin: IconPin,
  plus: IconPlusSmall,
  "provider-opencode": IconOpencode,
  "provider-openrouter": IconOpenrouter,
  "provider-vercel": IconVercel,
  "pull-request": IconPullRequest,
  "pull-request-closed": IconPullRequestClosedSimple,
  react: IconReact,
  refresh: IconArrowRotateClockwise,
  return: IconArrowCornerDownLeft,
  ruler: IconRuler,
  search: IconMagnifyingGlass,
  server: IconServer,
  settings: IconSettingsGear2,
  shield: IconShield,
  slack: IconSlack,
  skills: IconBuildingBlocks,
  sparkle: IconSparklesSoft,
  "speed-low": IconSpeedLow,
  "split-down": IconLayoutTopBottom,
  "split-right": IconLayoutLeftRight,
  square: IconStop,
  "square-checklist": IconSquareChecklist,
  status: IconLiveActivity,
  "test-tube": IconTestTube,
  trash: IconTrashCan,
  trending: IconTrending4,
  typescript: IconTypescript,
  unarchive: IconUnarchiv,
  unpin: IconUnpin,
  user: IconUser,
  "user-key": IconUserKey,
  warning: IconBell2Active,
  website: IconWebsite,
  "window-app": IconWindowApp,
  writing: IconWriting,
  x: IconCrossSmall,
} satisfies Readonly<Record<string, Glyph>>;

export type IconName = keyof typeof GLYPHS;

/**
 * The names that also draw filled. Every Central glyph module carries its own
 * copy of the icon base, so a filled twin is added only for a mark that needs
 * the weight. Both packages export the same names, so these are their
 * `Default` exports.
 */
const FILLED_GLYPHS = {
  "bubble-question": IconBubbleQuestionDefault,
  warning: IconBell2ActiveDefault,
} satisfies Partial<Readonly<Record<IconName, Glyph>>>;

export type FilledIconName = keyof typeof FILLED_GLYPHS;

const styles = create({
  frame: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
  readonly xstyle?: Restyle<"Icon">;
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

export type IconProps = {
  readonly size?: number;
  readonly label?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"Icon">;
} & (
  | { readonly name: IconName; readonly variant?: "outlined" }
  | { readonly name: FilledIconName; readonly variant: "filled" }
);

export function Icon(iconProps: IconProps): ReactElement {
  const { size = 16, label, className, style, xstyle } = iconProps;

  const Glyph =
    iconProps.variant === "filled" ? FILLED_GLYPHS[iconProps.name] : GLYPHS[iconProps.name];

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
