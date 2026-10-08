import { radius, target } from "@nyte-ai/ui/schema.stylex";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTreeBatchOperation } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { Input } from "@nyte-ai/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { workbench } from "../theme/schema.stylex.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { changeSelectionSummary, filesChangedLabel, filterChangePaths } from "./change-tree.ts";
import type { ChangeStatus } from "./change-tree.ts";
import type { ViewedState } from "./changes-viewed.ts";
import type { VcsLineStat } from "@nyte-ai/protocol";
import { PIERRE_TREE_CSS } from "../pierre-worker-provider.tsx";
import { treeItemHeight, useTreeStatusTheme } from "./tree-theme.ts";
import { workbenchStyles } from "./workbench.stylex.ts";
import { WorkbenchRail } from "./workbench-rail.tsx";

export interface ChangesSidebarFile {
  readonly path: string;
  readonly status?: ChangeStatus;
  readonly stat: VcsLineStat;
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
  { value: "all", label: "All Files" },
  { value: "viewed", label: "Viewed" },
  { value: "not-viewed", label: "Not Viewed" },
];

const styles = create({
  // The stack's file header sits beside this row, so both take the workbench header height.
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box",
    minHeight: workbench.headerHeight,
    paddingBlock: workbench.headerPaddingBlock,
    flexShrink: 0,
    paddingInline: 4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  field: { flex: 1 },
  // Short labels with no icons, so the menu fits them instead of the default menu width.
  filterMenu: { minWidth: 0 },
  overviewTitle: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minHeight: target.min,
    paddingInline: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 590,
  },
  overviewLabel: { flex: 1, minWidth: 0, overflow: "clip", whiteSpace: "nowrap" },
  checkbox: { marginInlineStart: 4 },
  checkboxChanged: {
    borderColor: role.contentInteractiveTertiary,
    color: role.contentInteractiveTertiary,
    "::after": {
      content: "''",
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: "currentColor",
    },
  },
  tree: {
    display: "block",
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

/**
 * `"changed"` is a viewed mark the patch has outrun: a check would claim too much.
 * `"unknown"` is a mark not yet checked against an unread patch, which no check claims either.
 */
export type ReviewCheckboxState = "unviewed" | "viewed" | "changed" | "unknown" | "mixed";

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
    <Checkbox
      checked={state === "viewed"}
      indeterminate={state === "mixed"}
      aria-label={label}
      title={label}
      data-viewed-state={state}
      xstyle={[
        styles.checkbox,
        state === "changed" && intent.warning,
        state === "changed" && styles.checkboxChanged,
      ]}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={onChange}
    />
  );
}

export function sidebarCountLabel(total: number, shown: number, filtered: boolean): string {
  if (!filtered || shown === total) return filesChangedLabel(total);

  return `${String(shown)} of ${filesChangedLabel(total)}`;
}

export const ChangesSidebar = memo(function ChangesSidebar({
  files,
  activePath,
  filterInputRef,
  onRevealPath,
  onAllViewedChange,
}: {
  readonly files: readonly ChangesSidebarFile[];
  readonly activePath: string | undefined;
  readonly filterInputRef?: RefObject<HTMLInputElement | null>;
  readonly onRevealPath: (path: string) => void;
  readonly onAllViewedChange: (paths: readonly string[], viewed: boolean) => void;
}): ReactElement {
  const treeStatusTheme = useTreeStatusTheme();
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

  const [itemHeight] = useState(treeItemHeight);

  const { model } = useFileTree({
    paths: [],
    density: "compact",
    itemHeight,
    unsafeCSS: PIERRE_TREE_CSS,
    initialExpansion: "open",
    onSelectionChange: (selected) => {
      if (syncing.current) return;
      const path = selected.findLast((path) => current.current.fileByPath.has(path));

      if (path !== undefined) current.current.onRevealPath(path);
    },
    renderRowDecoration: ({ item }) => {
      const file = current.current.fileByPath.get(item.path);

      if (file?.stat.kind !== "text") return null;
      const { added, removed } = file.stat;

      return {
        text: [added > 0 ? `+${added}` : "", removed > 0 ? `-${removed}` : ""]
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
        const added = file.stat.kind === "text" ? file.stat.added : 0;
        const removed = file.stat.kind === "text" ? file.stat.removed : 0;

        const status =
          file.status ??
          (added > 0 && removed === 0
            ? "added"
            : removed > 0 && added === 0
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
    <WorkbenchRail>
      {/* Outside the tree: focus inside it makes the tree pull focus back to a row as the rows change. */}
      <div {...props(styles.search)}>
        <Input
          ref={filterInputRef}
          id={searchId}
          type="text"
          aria-label="Filter changed files"
          placeholder="Filter files"
          autoComplete="off"
          spellCheck={false}
          value={query}
          xstyle={styles.field}
          onValueChange={setQuery}
        />
        <Menu>
          <MenuTrigger
            render={
              <Button
                iconOnly
                icon="filters"
                aria-label="Change file filters"
                aria-pressed={filtering}
              />
            }
          />
          <MenuContent align="end" xstyle={styles.filterMenu}>
            {STATUS_FILTERS.map((option) => (
              <MenuCheckboxItem
                key={option.value}
                layout="plain"
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
                <MenuRadioItem key={option.value} value={option.value} layout="plain">
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
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
      <FileTree
        model={model}
        aria-label="Changed files"
        {...props(workbenchStyles.treeTheme, treeStatusTheme, styles.tree)}
      />
    </WorkbenchRail>
  );
});
