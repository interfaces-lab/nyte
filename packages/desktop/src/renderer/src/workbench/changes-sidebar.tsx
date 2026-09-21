import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeBatchOperation } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
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
import { changeSelectionSummary, filesChangedLabel, filterChangePaths } from "./change-tree.ts";
import type { ChangeStatus } from "./change-tree.ts";
import type { ViewedState } from "./changes-viewed.ts";

export interface ChangesSidebarFile {
  readonly path: string;
  readonly status?: ChangeStatus;
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
  { value: "conflicted", label: "Conflicted" },
];
const VIEWED_FILTERS: readonly { readonly value: ViewedFilterMode; readonly label: string }[] = [
  { value: "all", label: "All files" },
  { value: "viewed", label: "Viewed" },
  { value: "not-viewed", label: "Not viewed" },
];
const styles = create({
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
  tree: {
    display: "block",
    flex: 1,
    minHeight: 0,
    width: "100%",
    "--trees-bg-override": t.bgSubtle,
    "--trees-fg-override": t.textSecondary,
    "--trees-fg-muted-override": t.textTertiary,
    "--trees-selected-bg-override": t.fillGhostSelected,
    "--trees-selected-fg-override": t.textPrimary,
    "--trees-focus-ring-color-override": t.focusRing,
    "--trees-font-family-override": t.fontSans,
    "--trees-font-size-override": t.fontSm,
    "--trees-scrollbar-thumb-override": t.scrollbarThumb,
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
      {...props(
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
      {state === "mixed" && <span aria-hidden="true" {...props(styles.checkboxDash)} />}
      {state === "changed" && <span aria-hidden="true" {...props(styles.checkboxDot)} />}
    </button>
  );
}

export function sidebarCountLabel(total: number, shown: number, filtered: boolean): string {
  if (!filtered || shown === total) return filesChangedLabel(total);
  return `${String(shown)} of ${filesChangedLabel(total)}`;
}

export const ChangesSidebar = memo(function ChangesSidebar({
  files,
  visible,
  activePath,
  filterInputRef,
  onRevealPath,
  onAllViewedChange,
}: {
  readonly files: readonly ChangesSidebarFile[];
  readonly visible: boolean;
  readonly activePath: string | undefined;
  readonly filterInputRef?: RefObject<HTMLInputElement | null>;
  readonly onRevealPath: (path: string) => void;
  readonly onAllViewedChange: (paths: readonly string[], viewed: boolean) => void;
}): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<readonly ChangeStatus[]>([]);
  const [viewedMode, setViewedMode] = useState<ViewedFilterMode>("all");
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const current = useRef({ fileByPath, onRevealPath });
  useLayoutEffect(() => {
    current.current = { fileByPath, onRevealPath };
  }, [fileByPath, onRevealPath]);
  const syncing = useRef(false);
  const paths = useRef<ReadonlySet<string>>(new Set());
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    initialExpansion: "open",
    onSelectionChange: (selected) => {
      if (syncing.current) return;
      const path = selected.findLast((path) => current.current.fileByPath.has(path));
      if (path !== undefined) current.current.onRevealPath(path);
    },
    renderRowDecoration: ({ item }) => {
      const file = current.current.fileByPath.get(item.path);
      if (file === undefined) return null;
      return {
        text: [file.added > 0 ? `+${file.added}` : "", file.removed > 0 ? `-${file.removed}` : ""]
          .filter(Boolean)
          .join(" "),
      };
    },
  });
  const filtering = query.trim() !== "" || statuses.length > 0 || viewedMode !== "all";
  const shownPaths = useMemo(
    () =>
      filterChangePaths(files, {
        query,
        statuses,
        viewed:
          viewedMode === "all"
            ? { mode: "all" }
            : { mode: viewedMode, isViewed: (path) => fileByPath.get(path)?.viewed === "viewed" },
      }),
    [files, fileByPath, query, statuses, viewedMode],
  );
  useLayoutEffect(() => {
    const next = new Set(
      shownPaths.flatMap((path) => {
        const ancestors = [path];
        for (
          let index = path.lastIndexOf("/");
          index > 0;
          index = path.lastIndexOf("/", index - 1)
        ) {
          ancestors.push(path.slice(0, index + 1));
        }
        return ancestors;
      }),
    );
    const changes: FileTreeBatchOperation[] = [
      ...[...paths.current]
        .filter((path) => !next.has(path))
        .sort((left, right) => right.length - left.length)
        .map((path) => ({ type: "remove" as const, path })),
      ...shownPaths
        .filter((path) => !paths.current.has(path))
        .map((path) => ({ type: "add" as const, path })),
    ];
    syncing.current = true;
    if (changes.length > 0) model.batch(changes);
    paths.current = next;
    for (const selected of model.getSelectedPaths()) {
      if (selected !== activePath) model.getItem(selected)?.deselect();
    }
    if (activePath !== undefined) model.getItem(activePath)?.select();
    syncing.current = false;
  }, [model, shownPaths, activePath]);
  useLayoutEffect(() => {
    model.setGitStatus(
      files.map((file) => {
        const status =
          file.status ??
          (file.added > 0 && file.removed === 0
            ? "added"
            : file.removed > 0 && file.added === 0
              ? "deleted"
              : "modified");
        return { path: file.path, status: status === "conflicted" ? "modified" : status };
      }),
    );
  }, [model, files]);
  const summary = changeSelectionSummary(
    shownPaths,
    (path) => fileByPath.get(path)?.viewed === "viewed",
  );
  return (
    <div {...props(styles.rail, !visible && styles.railHidden)}>
      <FileTree
        model={model}
        aria-label="Changed files"
        {...props(styles.tree)}
        header={
          <>
            <div {...props(styles.search)}>
              <div {...props(styles.field)}>
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
                  {...props(styles.input)}
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
            <div {...props(styles.overviewTitle)}>
              <span {...props(styles.overviewLabel)}>
                {sidebarCountLabel(files.length, shownPaths.length, filtering)}
              </span>
              <ReviewCheckbox
                state={summary === "all" ? "viewed" : summary === "some" ? "mixed" : "unviewed"}
                label={summary === "all" ? "Mark all files not viewed" : "Mark all files viewed"}
                onChange={(viewed) => onAllViewedChange(shownPaths, viewed)}
              />
            </div>
            {shownPaths.length === 0 && (
              <div role="status" {...props(styles.empty)}>
                No files match this filter
              </div>
            )}
          </>
        }
      />
    </div>
  );
});
