/**
 * The changed-files rail of the Changes panel: a grouped tree, a search field,
 * a status and review filter, and Cursor's per-file viewed checkboxes.
 *
 * The rail owns what only the rail can see — the query, the filter, and which
 * groups are collapsed. Review marks are the panel's, because the digest a
 * mark is filed under is the digest of the patch the panel renders.
 */
import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon";
import { Icon } from "../components/icons.tsx";
import {
  Menu,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../components/menu.tsx";
import { focus, IconButton } from "../components/ui";
import { workbench } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import {
  changeSelectionSummary,
  filesChangedLabel,
  changeFileGroups,
  filterChangePaths,
  visibleChangeTreeRows,
} from "./change-tree.ts";
import type { ChangeFileTone, ChangeStatus } from "./change-tree.ts";
import type { ViewedState } from "./changes-viewed.ts";
import { pretextFitsWidth, pretextNaturalWidth, truncateMiddleText } from "./pretext.ts";
import { diffMarksWidth, railLabelMaxWidth, railRowWidth } from "./stacked-diff.ts";
import { useClientBox } from "./use-client-box.ts";

/** One rail row's worth of panel state: what it is, how big, and whether it was reviewed. */
export interface ChangesSidebarFile {
  readonly path: string;
  /** Absent for per-turn changes, which have no working-tree status to filter on. */
  readonly status?: ChangeStatus;
  readonly tone?: ChangeFileTone;
  readonly added: number;
  readonly removed: number;
  readonly viewed: ViewedState;
}

type ViewedFilterMode = "all" | "viewed" | "not-viewed";

const STATUS_FILTERS: readonly { readonly value: ChangeStatus; readonly label: string }[] = [
  { value: "added", label: "Added" },
  { value: "modified", label: "Modified" },
  { value: "deleted", label: "Deleted" },
  { value: "untracked", label: "Untracked" },
];

const VIEWED_FILTERS: readonly { readonly value: ViewedFilterMode; readonly label: string }[] = [
  { value: "all", label: "All files" },
  { value: "viewed", label: "Viewed" },
  { value: "not-viewed", label: "Not viewed" },
];

/** The trailing checkbox and its gap, which the measured label never gets. */
const REVIEW_SLOT_WIDTH = 20;

/** The revert button and its gap, taken from the label only while the rail offers one. */
const REVERT_SLOT_WIDTH = 20;

const styles = stylex.create({
  rail: {
    order: 1,
    display: "flex",
    flexDirection: "column",
    width: workbench.fileListWidth,
    flexShrink: 0,
    minHeight: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeTertiary,
    backgroundColor: t.bgSubtle,
  },
  railHidden: { display: "none" },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    padding: 4,
  },
  field: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: 24,
    gap: 4,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.strokeSecondary, ":focus-within": t.strokeFocused },
    borderRadius: t.radiusBase,
    backgroundColor: t.bgElevated,
    color: t.iconTertiary,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: { default: t.textPrimary, "::placeholder": t.textTertiary },
    fontFamily: "inherit",
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 4,
  },
  overviewTitle: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    paddingInline: 6,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontWeight: 590,
  },
  overviewLabel: { flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: 24,
    paddingInlineEnd: 6,
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: t.textSecondary,
  },
  rowSelected: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  file: {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    paddingInline: 6,
    borderRadius: t.radiusBase,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textAlign: "left",
    cursor: "pointer",
  },
  folder: { color: t.textTertiary },
  nameAdded: { color: t.textSuccess },
  nameDeleted: { color: t.textDanger, textDecoration: "line-through" },
  nameModified: { color: t.textWarning },
  glyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    flexShrink: 0,
    color: t.iconTertiary,
  },
  filePath: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  fileStat: {
    display: "inline-flex",
    gap: 2,
    flexShrink: 0,
    fontSize: t.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: t.textSuccess },
  removed: { color: t.textDanger },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 1,
    flexShrink: 0,
  },
  pipAdded: { backgroundColor: t.textSuccess },
  pipDeleted: { backgroundColor: t.textDanger },
  pipModified: { backgroundColor: t.textWarning },
  checkbox: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    flexShrink: 0,
    marginInlineStart: 4,
    padding: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.strokeSecondary, ":hover": t.strokeFocused },
    borderRadius: t.radiusSm,
    backgroundColor: "transparent",
    color: t.iconSecondary,
    cursor: "pointer",
  },
  checkboxOn: {
    borderColor: t.accent,
    backgroundColor: t.fillAccent,
    color: t.textOnColor,
  },
  checkboxChanged: { borderColor: t.textWarning, color: t.textWarning },
  checkboxDash: {
    width: 8,
    height: 2,
    borderRadius: t.radiusFull,
    backgroundColor: "currentColor",
  },
  checkboxDot: {
    width: 6,
    height: 6,
    borderRadius: t.radiusFull,
    backgroundColor: "currentColor",
  },
  revert: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    flexShrink: 0,
    marginInlineStart: 4,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusSm,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: { default: t.iconTertiary, ":hover": t.iconSecondary },
    cursor: "pointer",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    color: t.textTertiary,
    fontSize: t.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

/** `"changed"` is a viewed mark the patch has outrun: a check would claim too much. */
export type ReviewCheckboxState = "unviewed" | "viewed" | "changed" | "mixed";

export function ReviewCheckbox({
  state,
  label,
  onChange,
}: {
  readonly state: ReviewCheckboxState;
  readonly label: string;
  readonly onChange: (viewed: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "viewed" ? true : state === "mixed" ? "mixed" : false}
      aria-label={label}
      title={label}
      data-viewed-state={state}
      {...stylex.props(
        styles.checkbox,
        focus.ring,
        (state === "viewed" || state === "mixed") && styles.checkboxOn,
        state === "changed" && styles.checkboxChanged,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onChange(state !== "viewed");
      }}
    >
      {state === "viewed" && <Icon name="checkmark" size={10} />}
      {state === "mixed" && <span aria-hidden="true" {...stylex.props(styles.checkboxDash)} />}
      {state === "changed" && <span aria-hidden="true" {...stylex.props(styles.checkboxDot)} />}
    </button>
  );
}

function DiffMarks({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}): ReactElement | null {
  if (added === 0 && removed === 0) return null;
  return (
    <span {...stylex.props(styles.fileStat)}>
      {added > 0 && (
        <span {...stylex.props(styles.added)}>
          +<AnimatedNumber value={added} />
        </span>
      )}
      {removed > 0 && (
        <span {...stylex.props(styles.removed)}>
          -<AnimatedNumber value={removed} />
        </span>
      )}
    </span>
  );
}

function StatusPip({ tone }: { readonly tone: ChangeFileTone | undefined }): ReactElement | null {
  if (tone === undefined) return null;
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.pip,
        tone === "added" && styles.pipAdded,
        tone === "deleted" && styles.pipDeleted,
        tone === "modified" && styles.pipModified,
      )}
    />
  );
}

/** The unfiltered total, plus how much of it survives the filter while one is on. */
export function sidebarCountLabel(total: number, shown: number, filtered: boolean): string {
  if (!filtered || shown === total) return filesChangedLabel(total);
  return `${String(shown)} of ${filesChangedLabel(total)}`;
}

function viewedLabel(path: string, state: ViewedState): string {
  if (state === "viewed") return `Mark ${path} not viewed`;
  if (state === "changed") return `${path} changed since you viewed it`;
  return `Mark ${path} viewed`;
}

export function ChangesSidebar({
  files,
  visible,
  activePath,
  statsKey,
  fonts,
  filterInputRef,
  onRevealPath,
  onRevertPath,
  onViewedChange,
  onAllViewedChange,
}: {
  readonly files: readonly ChangesSidebarFile[];
  readonly visible: boolean;
  readonly activePath: string | undefined;
  /** Remounts the animated counters when the scope changes rather than tweening across it. */
  readonly statsKey: string;
  readonly fonts: { readonly ui: string; readonly xs: string };
  /** The panel's filter command focuses the rail's field, which is display:none while the rail is hidden. */
  readonly filterInputRef?: RefObject<HTMLInputElement | null>;
  readonly onRevealPath: (path: string) => void;
  /** Absent outside a working tree, where there is nothing to revert to; the affordance renders disabled. */
  readonly onRevertPath?: (path: string) => void;
  readonly onViewedChange: (path: string, viewed: boolean) => void;
  readonly onAllViewedChange: (paths: readonly string[], viewed: boolean) => void;
}): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<readonly ChangeStatus[]>([]);
  const [viewedMode, setViewedMode] = useState<ViewedFilterMode>("all");
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [attachList, listWidth] = useClientBox();

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const filtering = query.trim() !== "" || statuses.length > 0 || viewedMode !== "all";
  const shownPaths = filterChangePaths(
    files.map((file) => ({ path: file.path, status: file.status })),
    {
      query,
      statuses,
      viewed:
        viewedMode === "all"
          ? { mode: "all" }
          : {
              mode: viewedMode,
              isViewed: (path) => fileByPath.get(path)?.viewed === "viewed",
            },
    },
  );
  const groups = changeFileGroups(shownPaths);
  const treeRows = visibleChangeTreeRows({ groups, collapsed });
  const groupByPath = new Map(groups.map((group) => [group.path, group]));
  const summary = changeSelectionSummary(
    shownPaths,
    (path) => fileByPath.get(path)?.viewed === "viewed",
  );
  const rowWidth = railRowWidth(listWidth);

  return (
    <div {...stylex.props(styles.rail, !visible && styles.railHidden)}>
      <div {...stylex.props(styles.search)}>
        <div {...stylex.props(styles.field)}>
          <Icon name="search" size={12} />
          <input
            ref={filterInputRef}
            id={searchId}
            type="text"
            aria-label="Filter changed files"
            placeholder="Filter files"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            {...stylex.props(styles.input)}
          />
        </div>
        <Menu
          label="Filter changes"
          trigger={
            <IconButton
              icon="filters"
              label={filtering ? "Filters on" : "Filter changes"}
              aria-pressed={filtering}
            />
          }
        >
          {STATUS_FILTERS.map((option) => (
            <MenuCheckboxItem
              key={option.value}
              checked={statuses.includes(option.value)}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                setStatuses((current) =>
                  checked
                    ? [...current, option.value]
                    : current.filter((status) => status !== option.value),
                );
              }}
            >
              {option.label}
            </MenuCheckboxItem>
          ))}
          <MenuSeparator />
          <MenuRadioGroup
            value={viewedMode}
            onValueChange={(value) => {
              const found = VIEWED_FILTERS.find((option) => option.value === value);
              if (found !== undefined) setViewedMode(found.value);
            }}
          >
            {VIEWED_FILTERS.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
      </div>
      <div
        ref={attachList}
        role="tree"
        aria-label="Changed files"
        data-nyte-scrollport
        {...stylex.props(styles.list)}
      >
        <div {...stylex.props(styles.overviewTitle)}>
          <span {...stylex.props(styles.overviewLabel)}>
            {sidebarCountLabel(files.length, shownPaths.length, filtering)}
          </span>
          <ReviewCheckbox
            state={summary === "all" ? "viewed" : summary === "some" ? "mixed" : "unviewed"}
            label={summary === "all" ? "Mark all files not viewed" : "Mark all files viewed"}
            onChange={(viewed) => {
              onAllViewedChange(shownPaths, viewed);
            }}
          />
        </div>
        {treeRows.length === 0 ? (
          <div role="status" {...stylex.props(styles.empty)}>
            No files match this filter
          </div>
        ) : (
          treeRows.map((entry) => {
            const file = fileByPath.get(entry.path);
            const group = groupByPath.get(entry.path);
            const expanded = entry.kind === "directory" && !collapsed.includes(entry.path);
            const marks =
              group === undefined
                ? { added: file?.added ?? 0, removed: file?.removed ?? 0 }
                : group.files.reduce(
                    (total, path) => {
                      const member = fileByPath.get(path);
                      return member === undefined
                        ? total
                        : {
                            added: total.added + member.added,
                            removed: total.removed + member.removed,
                          };
                    },
                    { added: 0, removed: 0 },
                  );
            const statsWidth =
              rowWidth === 0
                ? 0
                : diffMarksWidth({
                    added: marks.added,
                    removed: marks.removed,
                    measure: (text) => pretextNaturalWidth(text, fonts.xs),
                  });
            const labelWidth = Math.max(
              0,
              railLabelMaxWidth({
                rowWidth,
                depth: entry.depth,
                statsWidth,
                hasPip: entry.kind === "file",
              }) -
                REVIEW_SLOT_WIDTH -
                (entry.kind === "file" ? REVERT_SLOT_WIDTH : 0),
            );
            const label = truncateMiddleText({
              text: entry.label,
              maxWidth: labelWidth,
              fits: (value) =>
                labelWidth <= 0 ? true : pretextFitsWidth(value, fonts.ui, labelWidth),
            });
            const selected = entry.kind === "file" && entry.path === activePath;
            return (
              <div
                key={entry.path}
                role="treeitem"
                title={entry.path}
                aria-expanded={entry.kind === "directory" ? expanded : undefined}
                aria-selected={entry.kind === "file" ? selected : undefined}
                {...stylex.props(styles.row, selected && styles.rowSelected)}
              >
                <button
                  type="button"
                  {...stylex.props(
                    styles.file,
                    focus.ringInset,
                    entry.kind === "directory" && styles.folder,
                  )}
                  onClick={() => {
                    if (entry.kind === "directory") {
                      setCollapsed((current) =>
                        current.includes(entry.path)
                          ? current.filter((path) => path !== entry.path)
                          : [...current, entry.path],
                      );
                      return;
                    }
                    onRevealPath(entry.path);
                  }}
                >
                  {entry.depth > 0 && (
                    <span aria-hidden="true" style={{ flexShrink: 0, width: 10 }} />
                  )}
                  {entry.kind === "directory" ? (
                    <span {...stylex.props(styles.glyph)}>
                      <Icon name={expanded ? "chevron-down" : "chevron-right"} size={10} />
                    </span>
                  ) : (
                    <FileTypeIcon path={entry.path} />
                  )}
                  <span
                    {...stylex.props(
                      styles.filePath,
                      file?.tone === "added" && styles.nameAdded,
                      file?.tone === "deleted" && styles.nameDeleted,
                      file?.tone === "modified" && styles.nameModified,
                    )}
                  >
                    {label}
                  </span>
                  <DiffMarks key={statsKey} added={marks.added} removed={marks.removed} />
                  {entry.kind === "file" && <StatusPip tone={file?.tone} />}
                </button>
                {entry.kind === "file" && file !== undefined && (
                  <>
                    <button
                      type="button"
                      aria-label={`Revert ${file.path}`}
                      title={`Revert ${file.path}`}
                      disabled={onRevertPath === undefined}
                      {...stylex.props(styles.revert, focus.ring)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRevertPath?.(file.path);
                      }}
                    >
                      <Icon name="refresh" size={10} />
                    </button>
                    <ReviewCheckbox
                      state={file.viewed}
                      label={viewedLabel(file.path, file.viewed)}
                      onChange={(viewed) => {
                        onViewedChange(file.path, viewed);
                      }}
                    />
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
