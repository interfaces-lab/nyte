/**
 * The Changes panel's header: which changes are on screen, which branch they
 * belong to, and how they are drawn.
 *
 * The scope menu is the only surface that knows every scope a reader can pick,
 * so it does its own reads: the working-tree counts and the history page are
 * fetched by the rows that show them, and nothing is read until the menu opens.
 * The panel keeps the read that produces the diffs it renders.
 *
 * Nothing here writes to the repository. The branch readout reports HEAD and
 * offers no checkout, and refresh only invalidates the reads.
 */
import { Button } from "@nyte-ai/ui";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { Icon, PanelToggleIcon } from "../components/icons.tsx";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
} from "../components/menu.tsx";
import type { IconName } from "../components/icons.tsx";
import { focus, IconButton, ToggleIconButton } from "../components/ui";
import { macPlatform } from "../platform.ts";
import { useVcsLog, useVcsScopedDiffs } from "../queries.ts";
import type { VcsScopedDiffsIdentity } from "../queries.ts";
import { menu, workbench } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { ChangesCommitBar, isWorkingTreeScope } from "./changes-commit-bar.tsx";
import {
  changesScopeValue,
  commitScopeOptions,
  diffRequestForScope,
  turnHasChanges,
  visibleTurnOptions,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import type {
  BranchReadout,
  ChangeScopeStats,
  ChangesScopeOption,
  TurnChangeOption,
} from "./change-scopes.ts";
import type { ChangesLayout, ChangesViewOptions } from "./changes-view-options.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

/** One page of history, and how deep the menu will page before it stops offering more. */
const COMMIT_PAGE_SIZE = 20;
const MAX_COMMIT_PAGES = 10;

/** The repository a scope is read against; absent outside a Git working tree. */
export interface ChangesRepository {
  readonly repositoryId: string;
  readonly revision: string;
}

/** The panel's own keyboard bindings, which is all the Changes panel claims. */
export type ChangesShortcutAction = "filter-files" | "ignore-whitespace" | "refresh";

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "defaultPrevented"
  | "isComposing"
>;

/**
 * Cursor's Changes bindings, matched only while focus is inside the panel.
 * They are deliberately not window actions: ⌘R and ⌘F belong to whatever
 * surface has focus, and the panel must not take them from an editor or a page.
 */
export function changesShortcutAction(
  event: ShortcutEvent,
  mac: boolean,
): ChangesShortcutAction | undefined {
  if (event.isComposing || event.defaultPrevented) return undefined;
  if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey) {
    return event.code === "Semicolon" ? "ignore-whitespace" : undefined;
  }
  if (event.altKey || event.shiftKey) return undefined;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "f") return "filter-files";
  return key === "r" ? "refresh" : undefined;
}

export function changesShortcutLabel(action: ChangesShortcutAction, mac: boolean): string {
  switch (action) {
    case "filter-files":
      return mac ? "⌘F" : "Ctrl+F";
    case "ignore-whitespace":
      return mac ? "⌃⇧;" : "Ctrl+Shift+;";
    case "refresh":
      return mac ? "⌘R" : "Ctrl+R";
  }
}

const styles = stylex.create({
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
  },
  scopeTrigger: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 6,
    minWidth: 0,
    maxWidth: "calc(100% - 120px)",
    minHeight: workbench.headerHeight,
    paddingInline: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
      "[data-popup-open]": t.fillGhostSelected,
    },
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    cursor: "pointer",
  },
  scopeLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scopeStats: {
    display: "inline-flex",
    gap: 6,
    flexShrink: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
    fontWeight: 590,
    fontVariantNumeric: "tabular-nums",
  },
  scopeAdded: { color: t.textSuccess },
  scopeRemoved: { color: t.textDanger },
  scopeCount: {
    color: t.textTertiary,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  scopeDetail: {
    maxWidth: 160,
    overflow: "hidden",
    color: t.textTertiary,
    fontSize: t.fontSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scopeChevron: { display: "inline-flex", flexShrink: 0, color: t.iconTertiary },
  scopeMenu: {
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
  },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    paddingInline: 6,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  branchLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branchTag: {
    flexShrink: 0,
    paddingInline: 4,
    borderRadius: t.radiusSm,
    backgroundColor: t.fillGhostHover,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
  },
  branchCount: { flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  spacer: { flex: 1, minWidth: 0 },
});

export function ChangeStats({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}): ReactElement | null {
  if (added === 0 && removed === 0) return null;
  return (
    <span
      aria-label={`${String(added)} added, ${String(removed)} removed`}
      {...stylex.props(styles.scopeStats)}
    >
      {added > 0 && (
        <span {...stylex.props(styles.scopeAdded)}>
          +<AnimatedNumber value={added} />
        </span>
      )}
      {removed > 0 && (
        <span {...stylex.props(styles.scopeRemoved)}>
          -<AnimatedNumber value={removed} />
        </span>
      )}
    </span>
  );
}

/** A row's counts, or the files it holds while its diff has not been read. */
function ScopeMeta({
  stats,
  fileCount,
}: {
  readonly stats: ChangeScopeStats | undefined;
  readonly fileCount: number | undefined;
}): ReactElement | null {
  if (stats !== undefined && (stats.added > 0 || stats.removed > 0))
    return <ChangeStats {...stats} />;
  if (fileCount === undefined) return null;
  return (
    <span {...stylex.props(styles.scopeCount)}>
      {String(fileCount)} {fileCount === 1 ? "file" : "files"}
    </span>
  );
}

function scopeIcon(scope: WorkbenchChangesScope): IconName {
  switch (scope.kind) {
    case "turn":
      return "git-branch";
    case "commit":
      return "git";
    default:
      return "file";
  }
}

/**
 * A row for one scope. Every scope stays selectable, including one with no
 * counts and no files: picking it is how a reader learns it is empty.
 */
function ScopeRadioItem({ option }: { readonly option: ChangesScopeOption }): ReactElement {
  return (
    <MenuRadioItem
      value={changesScopeValue(option.scope)}
      icon={scopeIcon(option.scope)}
      label={option.label}
      meta={
        <>
          {option.detail !== undefined && (
            <span {...stylex.props(styles.scopeDetail)}>{option.detail}</span>
          )}
          <ScopeMeta stats={option.stats} fileCount={option.fileCount} />
        </>
      }
    >
      {option.label}
    </MenuRadioItem>
  );
}

function scopedDiffsIdentity(
  repository: ChangesRepository | undefined,
  scope: WorkbenchChangesScope,
  ignoreWhitespace: boolean,
): VcsScopedDiffsIdentity | undefined {
  const request = diffRequestForScope(scope, { ignoreWhitespace });
  if (repository === undefined || request === undefined) return undefined;
  return { repositoryId: repository.repositoryId, revision: repository.revision, request };
}

/**
 * Uncommitted and the index split, each with its own counts. The reads run
 * only while the menu is open, and the one serving the selected scope is the
 * panel's own read, answered from the cache.
 */
function WorkingTreeScopeItems({
  snapshot,
  repository,
  ignoreWhitespace,
}: {
  readonly snapshot: DesktopVcsSnapshot | undefined;
  readonly repository: ChangesRepository | undefined;
  readonly ignoreWhitespace: boolean;
}): ReactElement {
  const uncommitted = useVcsScopedDiffs(
    scopedDiffsIdentity(repository, { kind: "uncommitted" }, ignoreWhitespace),
    repository !== undefined,
  );
  const staged = useVcsScopedDiffs(
    scopedDiffsIdentity(repository, { kind: "staged" }, ignoreWhitespace),
    repository !== undefined && snapshot?.staged !== undefined,
  );
  const unstaged = useVcsScopedDiffs(
    scopedDiffsIdentity(repository, { kind: "unstaged" }, ignoreWhitespace),
    repository !== undefined && snapshot?.unstaged !== undefined,
  );
  const options = workingTreeScopeOptions(snapshot, {
    uncommitted: uncommitted.data,
    staged: staged.data,
    unstaged: unstaged.data,
  });
  return (
    <>
      {options.map((option) => (
        <ScopeRadioItem key={changesScopeValue(option.scope)} option={option} />
      ))}
    </>
  );
}

/**
 * One page of history and, on request, the page after it. Each page owns its
 * own read, so paging never refetches the pages already on screen.
 */
function CommitScopeItems({
  repository,
  statsByOid,
  before,
  page,
}: {
  readonly repository: ChangesRepository | undefined;
  readonly statsByOid: ReadonlyMap<string, ChangeScopeStats>;
  readonly before: string | undefined;
  readonly page: number;
}): ReactElement {
  const [showNextPage, setShowNextPage] = useState(false);
  const log = useVcsLog(
    before === undefined ? { limit: COMMIT_PAGE_SIZE } : { limit: COMMIT_PAGE_SIZE, before },
    repository !== undefined,
  );
  const commits = log.data?.commits ?? [];
  const oldest = commits.at(-1);
  const hasMore = log.data?.hasMore === true && oldest !== undefined && page < MAX_COMMIT_PAGES;
  return (
    <>
      {page === 1 && commits.length === 0 && (
        <MenuItem disabled onSelect={() => undefined}>
          {log.isPending ? "Reading history…" : "No commits yet"}
        </MenuItem>
      )}
      {commitScopeOptions(commits, statsByOid).map((option) => (
        <ScopeRadioItem key={changesScopeValue(option.scope)} option={option} />
      ))}
      {hasMore &&
        (showNextPage ? (
          <CommitScopeItems
            repository={repository}
            statsByOid={statsByOid}
            before={oldest.oid}
            page={page + 1}
          />
        ) : (
          <MenuItem
            icon="clock"
            closeOnClick={false}
            onSelect={() => {
              setShowNextPage(true);
            }}
          >
            Load older commits
          </MenuItem>
        ))}
    </>
  );
}

function branchDescription(branch: BranchReadout): string {
  const parts = [branch.detached ? `Detached at ${branch.label}` : `On branch ${branch.label}`];
  if (branch.unborn) parts.push("no commits yet");
  if (branch.upstream !== undefined) parts.push(`tracking ${branch.upstream}`);
  if (branch.ahead > 0) parts.push(`${String(branch.ahead)} ahead`);
  if (branch.behind > 0) parts.push(`${String(branch.behind)} behind`);
  return parts.join(", ");
}

/** HEAD as it stands. Reading only: no checkout, no fetch, no branch switch. */
function BranchReadoutChip({ branch }: { readonly branch: BranchReadout }): ReactElement {
  const description = branchDescription(branch);
  return (
    <span aria-label={description} title={description} {...stylex.props(styles.branch)}>
      <Icon name={branch.detached ? "git" : "git-branch"} size={12} />
      <span {...stylex.props(styles.branchLabel)}>{branch.label}</span>
      {branch.detached && <span {...stylex.props(styles.branchTag)}>detached</span>}
      {branch.unborn && <span {...stylex.props(styles.branchTag)}>no commits</span>}
      {branch.ahead > 0 && (
        <span aria-hidden="true" {...stylex.props(styles.branchCount)}>
          ↑{String(branch.ahead)}
        </span>
      )}
      {branch.behind > 0 && (
        <span aria-hidden="true" {...stylex.props(styles.branchCount)}>
          ↓{String(branch.behind)}
        </span>
      )}
    </span>
  );
}

export interface ChangesToolbarProps {
  /** The scope the panel is showing, which is not always the stored one. */
  readonly scope: WorkbenchChangesScope;
  readonly scopeLabel: string;
  /** Counts and file total for the scope on screen; the menu reads the rest itself. */
  readonly scopeStats: ChangeScopeStats | undefined;
  readonly scopeFileCount: number | undefined;
  readonly snapshot: DesktopVcsSnapshot | undefined;
  readonly repository: ChangesRepository | undefined;
  readonly branch: BranchReadout | undefined;
  readonly turnOptions: readonly TurnChangeOption[];
  readonly viewOptions: ChangesViewOptions;
  readonly fileTreeVisible: boolean;
  readonly onScopeChange: (scope: WorkbenchChangesScope) => void;
  readonly onViewOptionsChange: (changes: Partial<ChangesViewOptions>) => void;
  readonly onToggleFileTree: () => void;
  readonly onRefresh: () => void;
  /** Focuses the rail's file filter; the rail owns the only search surface. */
  readonly onFilterFiles: () => void;
  /** Every file in the scope is collapsed, so the command offers to expand instead. */
  readonly allFilesCollapsed: boolean;
  readonly onToggleCollapseAll: () => void;
}

export function ChangesToolbar({
  scope,
  scopeLabel,
  scopeStats,
  scopeFileCount,
  snapshot,
  repository,
  branch,
  turnOptions,
  viewOptions,
  fileTreeVisible,
  onScopeChange,
  onViewOptionsChange,
  onToggleFileTree,
  onRefresh,
  onFilterFiles,
  allFilesCollapsed,
  onToggleCollapseAll,
}: ChangesToolbarProps): ReactElement {
  const [showAllTurns, setShowAllTurns] = useState(false);
  const mac = macPlatform(undefined);
  const scopeKey = changesScopeValue(scope);
  const selectedTurnId = scope.kind === "turn" ? scope.turnId : undefined;
  const visibleTurns = visibleTurnOptions(turnOptions, showAllTurns, selectedTurnId);
  const hasEmptyTurns = turnOptions.some((option) => !turnHasChanges(option));
  const commitStats: ReadonlyMap<string, ChangeScopeStats> =
    scope.kind === "commit" && scopeStats !== undefined
      ? new Map([[scope.oid, scopeStats]])
      : new Map();
  const selectScope = (value: string): void => {
    for (const candidate of [
      ...workingTreeScopeOptions(snapshot).map((option) => option.scope),
      ...turnOptions.map((option) => option.scope),
    ]) {
      if (changesScopeValue(candidate) === value) {
        onScopeChange(candidate);
        return;
      }
    }
    const commit = value.startsWith("commit:") ? value.slice("commit:".length) : undefined;
    if (commit !== undefined && commit !== "") onScopeChange({ kind: "commit", oid: commit });
  };

  return (
    <>
      <Toolbar.Root aria-label="Changes actions" {...stylex.props(styles.toolbar)}>
        <Menu
          label="Select changes"
          popupStyle={styles.scopeMenu}
          trigger={
            <Button
              unstyled
              type="button"
              aria-label={`Showing ${scopeLabel}`}
              {...stylex.props(styles.scopeTrigger, focus.ring)}
            >
              <Icon name={scopeIcon(scope)} size={14} />
              <span {...stylex.props(styles.scopeLabel)}>{scopeLabel}</span>
              <ScopeMeta key={scopeKey} stats={scopeStats} fileCount={scopeFileCount} />
              <span {...stylex.props(styles.scopeChevron)}>
                <Icon name="chevron-down" size={10} />
              </span>
            </Button>
          }
        >
          <MenuRadioGroup value={scopeKey} onValueChange={selectScope}>
            <WorkingTreeScopeItems
              snapshot={snapshot}
              repository={repository}
              ignoreWhitespace={viewOptions.ignoreWhitespace}
            />
            {repository !== undefined && (
              <MenuSubmenu
                label="Commits"
                icon="git"
                value={scope.kind === "commit" ? scopeLabel : undefined}
                popupStyle={styles.scopeMenu}
              >
                <MenuRadioGroup value={scopeKey} onValueChange={selectScope}>
                  <CommitScopeItems
                    repository={repository}
                    statsByOid={commitStats}
                    before={undefined}
                    page={1}
                  />
                </MenuRadioGroup>
              </MenuSubmenu>
            )}
            {visibleTurns.length > 0 && <MenuSeparator />}
            {visibleTurns.map((option) => (
              <MenuRadioItem
                key={option.scope.turnId}
                value={changesScopeValue(option.scope)}
                icon={turnHasChanges(option) ? "git-branch" : undefined}
                meta={<ChangeStats {...option.stats} />}
              >
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {hasEmptyTurns && (
            <>
              <MenuSeparator />
              <MenuCheckboxItem
                checked={showAllTurns}
                closeOnClick={false}
                onCheckedChange={setShowAllTurns}
              >
                Show all turns
              </MenuCheckboxItem>
            </>
          )}
        </Menu>
        {branch !== undefined && <BranchReadoutChip branch={branch} />}
        <span {...stylex.props(styles.spacer)} />
        <Toolbar.Button
          render={<IconButton icon="refresh" label="Refresh changes" onClick={onRefresh} />}
        />
        <Menu
          label="Changes view options"
          align="end"
          trigger={<IconButton icon="more-horizontal" label="More changes options" />}
        >
          <MenuSubmenu
            label="Layout"
            icon="split-right"
            value={viewOptions.layout === "split" ? "Split" : "Unified"}
          >
            <MenuRadioGroup
              value={viewOptions.layout}
              onValueChange={(value) => {
                const layout: ChangesLayout = value === "split" ? "split" : "unified";
                onViewOptionsChange({ layout });
              }}
            >
              <MenuRadioItem value="unified" icon="list">
                Unified
              </MenuRadioItem>
              <MenuRadioItem value="split" icon="split-right">
                Split
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuSubmenu>
          <MenuCheckboxItem
            checked={viewOptions.ignoreWhitespace}
            meta={changesShortcutLabel("ignore-whitespace", mac)}
            onCheckedChange={(checked) => {
              onViewOptionsChange({ ignoreWhitespace: checked });
            }}
          >
            Ignore whitespace
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={viewOptions.wordWrap}
            onCheckedChange={(checked) => {
              onViewOptionsChange({ wordWrap: checked });
            }}
          >
            Word wrap
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem
            icon="search"
            meta={changesShortcutLabel("filter-files", mac)}
            onSelect={onFilterFiles}
          >
            Filter files
          </MenuItem>
          <MenuItem
            icon={allFilesCollapsed ? "chevron-down" : "chevron-right"}
            onSelect={onToggleCollapseAll}
          >
            {allFilesCollapsed ? "Expand all files" : "Collapse all files"}
          </MenuItem>
          <MenuItem icon="refresh" meta={changesShortcutLabel("refresh", mac)} onSelect={onRefresh}>
            Refresh changes
          </MenuItem>
        </Menu>
        <Toolbar.Button
          render={
            <ToggleIconButton
              icon={<PanelToggleIcon side="right" visible={fileTreeVisible} />}
              label={fileTreeVisible ? "Hide file tree" : "Show file tree"}
              pressed={fileTreeVisible}
              onPressedChange={onToggleFileTree}
            />
          }
        />
      </Toolbar.Root>
      {repository !== undefined && isWorkingTreeScope(scope) && (
        <ChangesCommitBar scope={scope} branch={branch} fileCount={scopeFileCount ?? 0} />
      )}
    </>
  );
}
