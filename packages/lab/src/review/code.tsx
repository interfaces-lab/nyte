import { intent } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * What every code surface in the review shares: one Pierre preset, one file
 * header, and one way to turn a line selection into a side-chat reference.
 */
import { create, props } from "@stylexjs/stylex";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { FileTypeIcon } from "@nyte-ai/app/components/file-type-icon.tsx";
import { diffStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { PIERRE_THEME, PIERRE_TOKEN_CSS } from "@nyte-ai/app/pierre-worker-provider.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";

/** One file of the pull request at its current head. */
export interface ReviewFile {
  readonly path: string;
  readonly category: "implementation" | "test";
  readonly from: string;
  readonly to: string;
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
  readonly blobs: string;
  readonly metadata: FileDiffMetadata | undefined;
}

export function parsePatch(patch: string, key: string): FileDiffMetadata | undefined {
  return parsePatchFiles(patch, key).flatMap((parsed) => parsed.files)[0];
}

/**
 * How a message names selected lines: `path:12-18`, marked `at base` for
 * removed lines. The side chat forks the brief, which already read the patch,
 * so the place is enough; the lines need not be quoted.
 */
export function referenceOf(file: ReviewFile, range: SelectedLineRange): string {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const lines = start === end ? `${start}` : `${start}-${end}`;

  return `\`${file.path}:${lines}\`${range.side === "deletions" ? " at base" : ""}`;
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-display-mode"],
  });

  return () => observer.disconnect();
}

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.displayMode === "light" ? "light" : "dark";
}

/** The line colours the desktop's receipts use, for every Pierre surface here. */
export const PIERRE_CSS = `
${PIERRE_TOKEN_CSS}
[data-line-type="context"], [data-gutter-buffer] { --diffs-line-bg: var(--diffs-bg); }
[data-line-type="change-addition"] { --diffs-line-bg: var(--diffs-bg-addition-override); }
[data-line-type="change-deletion"] { --diffs-line-bg: var(--diffs-bg-deletion-override); }
[data-separator-content] { background-color: ${role.bgMutedTranslucent}; color: ${role.contentSecondary}; font-size: 12px; }
`;

export function usePierreOptions(layout: "unified" | "split") {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, readTheme);

  return useMemo(
    () =>
      ({
        theme: PIERRE_THEME,
        themeType: theme,
        diffStyle: layout,
        diffIndicators: "classic",
        hunkSeparators: "line-info",
        lineDiffType: "word",
        overflow: "scroll",
        unsafeCSS: PIERRE_CSS,
        enableLineSelection: true,
        enableGutterUtility: true,
      }) as const,
    [theme, layout],
  );
}

/** Sets Pierre's host variables: backgrounds, fonts, gutter. */
export const pierreHost = diffStyles.patch;

export type ReviewedState = "unreviewed" | "reviewed" | "changed";

/**
 * The header every file wears, in the Guide and in the Diff stack: the file,
 * where it lives, what changed, and whether you have reviewed it.
 */
export function CodeFileHeader({
  file,
  collapsed,
  reviewed,
  justUpdated,
  onToggle,
  onReviewed,
  onOpenInDiff,
}: {
  readonly file: ReviewFile;
  readonly collapsed: boolean;
  readonly reviewed: ReviewedState;
  readonly justUpdated: boolean;
  readonly onToggle: () => void;
  readonly onReviewed: (reviewed: boolean) => void;
  readonly onOpenInDiff?: () => void;
}): ReactElement {
  const name = file.path.split("/").at(-1) ?? file.path;
  const directory = file.path.slice(0, file.path.length - name.length);

  return (
    <div {...props(styles.header, !collapsed && styles.headerOpen)}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        onClick={onToggle}
        {...props(styles.toggle)}
      >
        <Icon
          name={collapsed ? "chevron-right" : "chevron-down"}
          size={12}
          xstyle={styles.chevron}
        />
        <FileTypeIcon path={file.path} />
        <span {...props(styles.name)}>{name}</span>
        <Tooltip>
          <TooltipTrigger render={<span {...props(styles.directory)}>{directory}</span>} />
          <TooltipContent>{file.path}</TooltipContent>
        </Tooltip>
      </button>
      {justUpdated && <span {...props([intent.warning, styles.updated])}>Just updated</span>}
      <span {...props(styles.counts)}>
        {file.added > 0 && <span {...props([intent.success, styles.added])}>+{file.added}</span>}
        {file.removed > 0 && (
          <span {...props([intent.danger, styles.removed])}>−{file.removed}</span>
        )}
      </span>
      <label {...props(styles.reviewed)}>
        <Checkbox
          checked={reviewed === "reviewed"}
          onCheckedChange={(checked) => onReviewed(checked)}
          aria-label={`Mark ${name} reviewed`}
        />
        Reviewed
      </label>
      <Menu>
        <MenuTrigger
          render={<Button iconOnly icon="more-horizontal" aria-label={`${name} actions`} />}
        />
        <MenuContent>
          {onOpenInDiff !== undefined && (
            <MenuItem icon="split-right" onClick={onOpenInDiff}>
              Open in Diff
            </MenuItem>
          )}
          <MenuItem icon="copy" onClick={() => void navigator.clipboard.writeText(file.path)}>
            Copy path
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

/**
 * The gutter action Pierre pins to the bottom of a selection, or to the
 * hovered line. One line tall, like Pierre's own utility button, and lifted
 * over the line number the way Pierre lifts its own.
 */
export function AddToChat({ onAdd }: { readonly onAdd: () => void }): ReactNode {
  return (
    <button
      type="button"
      aria-label="Add to chat"
      title="Add to chat"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onAdd}
      {...props(intent.primary, styles.addToChat)}
    >
      <Icon name="new-chat" size={12} />
    </button>
  );
}

export function Counts({ file }: { readonly file: ReviewFile }): ReactElement {
  return (
    <span {...props(styles.counts)}>
      {file.added > 0 && <span {...props([intent.success, styles.added])}>+{file.added}</span>}
      {file.removed > 0 && <span {...props([intent.danger, styles.removed])}>−{file.removed}</span>}
    </span>
  );
}

const styles = create({
  addToChat: {
    position: "relative",
    zIndex: 4,
    display: "grid",
    placeItems: "center",
    width: "1lh",
    height: "1lh",
    // Pierre's own utility button overhangs the number column the same way, so the column keeps its width.
    marginInlineEnd: "calc(-1lh + 1ch)",
    padding: 0,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: { default: role.buttonFill, ":hover": role.buttonFillHover },
    color: role.contentOnInteractiveStrong,
    cursor: appearance.cursorInteractive,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingInlineEnd: 8,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  headerOpen: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 6,
    flex: 1,
    minWidth: 0,
    paddingInlineStart: 10,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    cursor: appearance.cursorInteractive,
  },
  chevron: { color: role.contentInteractiveTertiary, flexShrink: 0 },
  name: { fontWeight: 500, whiteSpace: "nowrap" },
  directory: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  updated: {
    flexShrink: 0,
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: "18px",
    fontWeight: 500,
  },
  counts: {
    display: "inline-flex",
    gap: 6,
    flexShrink: 0,
    fontFamily: type.fontMono,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
  reviewed: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    color: role.contentSecondary,
    cursor: appearance.cursorInteractive,
  },
});
