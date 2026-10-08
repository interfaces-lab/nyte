import { create, props } from "@stylexjs/stylex";
import { parsePatchFacts, toolStatus } from "@nyte-ai/client";
import type { ToolClass, ToolTurnPart } from "@nyte-ai/protocol";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { button, glyph, radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { appearance, motion, role, type } from "@nyte-ai/ui/vars.stylex";
import { memo, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { FileTypeIcon } from "../components/file-type-icon.tsx";
import type { ToolCallDensity } from "../preferences/index.ts";
import { diffView } from "../theme/schema.stylex.ts";
import { DiffView } from "./diff-view.tsx";
import { fileFromUrl } from "./message-references.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import { activityStyles } from "./styles.stylex.ts";
import { tidyPath, toolNoun, toolVerbs } from "./tool-copy.ts";
import { ToolOutcome } from "./tool-line.tsx";

export type EditToolClass = Extract<
  ToolClass,
  { readonly kind: "file_patch" | "file_edit" | "file_write" }
>;

const DIMMED = `color-mix(in oklab, ${role.contentSecondary} 55%, ${role.contentTertiary})`;

const CARD_PREVIEW_ROWS = 4;

const TRANSITION = {
  transitionDuration: {
    default: motion.durationFast,
    "@media (prefers-reduced-motion: reduce)": "0s",
  },
  transitionTimingFunction: "ease-in-out",
} as const;

const styles = create({
  root: { display: "flex", flexDirection: "column", minWidth: 0 },
  line: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    letterSpacing: type.letterLg,
    whiteSpace: "nowrap",
    userSelect: "none",
    "--_action": role.contentSecondary,
    "--_file": {
      default: role.contentSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
    },
    "--_chevron": "0",
  },
  lineToggle: {
    cursor: appearance.cursorInteractive,
    "--_action": {
      default: role.contentSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
    },
    "--_chevron": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-within": "1",
      "[data-panel-open]": "1",
    },
  },
  lineDimmed: { "--_action": DIMMED, "--_file": DIMMED },
  action: { flexShrink: 0, color: "var(--_action)", transitionProperty: "color", ...TRANSITION },
  file: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: { default: "var(--_file)", ":focus-visible": role.contentSecondary },
    transitionProperty: "color",
    ...TRANSITION,
  },
  fileButton: {
    cursor: appearance.cursorInteractive,
    textDecorationLine: {
      default: "none",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "underline" },
    },
  },
  stats: {
    display: "inline-flex",
    flexShrink: 0,
    gap: 4,
    fontVariantNumeric: "tabular-nums",
  },
  statsLine: { marginInlineStart: 8 },
  stat: { color: role.contentSecondary },
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    color: role.contentTertiary,
    opacity: "var(--_chevron)",
    transitionProperty: "color, opacity",
    ...TRANSITION,
  },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    marginBlock: 2,
    overflow: "clip",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    "--_expand-opacity": {
      default: 0,
      ":hover": { "@media (hover: hover) and (pointer: fine)": 1 },
      ":focus-within": 1,
    },
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    minWidth: 0,
    paddingBlock: 6,
    paddingInline: 8,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textDecorationLine: "none",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  headerLink: { cursor: appearance.cursorInteractive },
  headerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 12,
    height: 12,
  },
  headerFile: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: role.contentSecondary,
  },
  cardBody: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  cardBodyCollapsed: {
    maxHeight: `calc(${CARD_PREVIEW_ROWS} * ${diffView.lineHeight})`,
    overflow: "clip",
  },
  expand: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    height: button.heightXs,
    paddingBottom: 1,
    backgroundImage: `linear-gradient(to bottom, transparent 0%, ${role.bgBase} 100%)`,
    color: {
      default: role.contentSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
    },
    opacity: { default: "var(--_expand-opacity)", ":focus-visible": 1 },
    transitionProperty: "color, opacity",
    ...TRANSITION,
  },
  expandOpen: { position: "relative", backgroundImage: "none", opacity: 1 },
  expandIconOpen: { transform: "rotate(180deg)" },
});

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function fileUrl(path: string, cwd: string | undefined): string | undefined {
  const absolute = path.startsWith("/") ? path : cwd === undefined ? undefined : `${cwd}/${path}`;

  if (absolute === undefined) return undefined;
  const url = new URL("file:///");
  url.pathname = absolute;

  return url.href;
}

function Stats({
  added,
  removed,
  line,
}: {
  readonly added: number;
  readonly removed: number;
  readonly line: boolean;
}): ReactElement | null {
  if (added === 0 && removed === 0) return null;

  return (
    <span
      aria-label={`${String(added)} added, ${String(removed)} removed`}
      {...props(styles.stats, line && styles.statsLine)}
    >
      {added > 0 && <span {...props(intent.success, styles.stat)}>+{added}</span>}
      {removed > 0 && <span {...props(intent.danger, styles.stat)}>-{removed}</span>}
    </span>
  );
}

/**
 * An edit is a file and its diff. Compact and balanced draw a verb line that
 * opens the diff in place; detailed draws a card whose header opens the file
 * and whose body previews four rows of the diff.
 */
export const EditCallView = memo(function EditCallView({
  part,
  toolClass,
  cwd,
  density,
}: {
  readonly part: ToolTurnPart;
  readonly toolClass: EditToolClass;
  readonly cwd: string | undefined;
  readonly density: ToolCallDensity;
}): ReactElement {
  const status = toolStatus(part.state);
  const running = status.tense === "running";
  const opener = useReferenceOpener();
  const [open, setOpen] = useState(false);

  const facts = useMemo(
    () => (toolClass.kind === "file_patch" ? parsePatchFacts(toolClass.patch) : undefined),
    [toolClass],
  );

  const path = tidyPath(toolClass.path, cwd);
  const name = basename(path);
  const added = facts?.added ?? 0;
  const removed = facts?.removed ?? 0;

  const created =
    toolClass.kind === "file_patch" &&
    toolClass.op === "write" &&
    facts !== undefined &&
    facts.removed === 0 &&
    facts.files.every((file) => file.hunks.every((hunk) => hunk.oldLines === 0));

  const verb =
    status.tense === "none"
      ? undefined
      : status.tone === "success" && created
        ? "Created"
        : toolVerbs(toolClass)[status.tense];

  const file = running ? undefined : fileFromUrl(fileUrl(toolClass.path, cwd) ?? "");
  const openFile = file === undefined ? undefined : opener?.({ kind: "file", file });

  const diff =
    facts === undefined || (added === 0 && removed === 0)
      ? undefined
      : { patch: facts.patch, added, removed };

  const rows = facts?.files.reduce(
    (total, entry) => total + entry.hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0),
    0,
  );

  if (density === "detailed" && diff !== undefined) {
    const expandable = (rows ?? 0) > CARD_PREVIEW_ROWS;

    const header = (
      <>
        <span aria-hidden="true" {...props(styles.headerIcon)}>
          <FileTypeIcon path={path} />
        </span>
        <span {...props(styles.headerFile)}>{name}</span>
        <Stats added={added} removed={removed} line={false} />
        <ToolOutcome status={status} />
      </>
    );

    return (
      <Collapsible.Root open={open} onOpenChange={setOpen} xstyle={styles.card}>
        <Tooltip>
          <TooltipTrigger
            render={
              openFile === undefined || file === undefined ? (
                <div {...props(styles.header)}>{header}</div>
              ) : (
                <a
                  href={file.url}
                  onClick={(event) => {
                    event.preventDefault();
                    openFile();
                  }}
                  {...props(styles.header, styles.headerLink, focus.ringInset)}
                >
                  {header}
                </a>
              )
            }
          />
          <TooltipContent>{path}</TooltipContent>
        </Tooltip>
        <div
          data-tool-body
          {...props(styles.cardBody, expandable && !open && styles.cardBodyCollapsed)}
        >
          <DiffView path={path} diff={diff} variant="card" />
        </div>
        {expandable && (
          <Collapsible.Trigger
            variant="plain"
            aria-label={open ? "Collapse edit diff" : "Expand edit diff"}
            xstyle={[styles.expand, open && styles.expandOpen, focus.ringInset]}
          >
            <span {...props(styles.headerIcon, open && styles.expandIconOpen)}>
              <Icon name="chevron-down" size={14} />
            </span>
          </Collapsible.Trigger>
        )}
      </Collapsible.Root>
    );
  }

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      disabled={diff === undefined}
      xstyle={styles.root}
    >
      <Collapsible.Trigger
        variant="plain"
        nativeButton={false}
        render={<div />}
        xstyle={[
          styles.line,
          diff !== undefined && styles.lineToggle,
          status.tone === "stopped" && styles.lineDimmed,
          focus.ringInset,
        ]}
      >
        {verb !== undefined && (
          <span {...props(styles.action, running && activityStyles.shimmer)}>{verb}</span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              openFile === undefined ? (
                <span {...props(styles.file)}>{name}</span>
              ) : (
                <a
                  href={file?.url}
                  onClick={(event) => {
                    event.preventDefault();
                    openFile();
                  }}
                  {...props(styles.file, styles.fileButton, focus.ring)}
                >
                  {name}
                </a>
              )
            }
          />
          <TooltipContent>{path}</TooltipContent>
        </Tooltip>
        {verb === undefined && <span {...props(styles.action)}>{toolNoun(toolClass)}</span>}
        {!running && <Stats added={added} removed={removed} line />}
        <ToolOutcome status={status} />
        {diff !== undefined && <Collapsible.Chevron size={10} xstyle={styles.chevron} />}
      </Collapsible.Trigger>
      {diff !== undefined && (
        <Collapsible.Panel data-tool-body>
          <DiffView path={path} diff={diff} variant="inline" />
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
});
