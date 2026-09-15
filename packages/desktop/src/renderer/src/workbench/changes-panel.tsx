/** Local working-tree and per-turn declared changes. GitHub never participates in this path. */
import { Button as BaseButton } from "@nyte-ai/ui";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { FileChange, SessionId, Turn, VcsStatus } from "@nyte-ai/core";
import { changesFromTurns } from "@nyte-ai/core/views";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon, FileTypeIconSprite } from "../components/file-type-icon";
import { Icon, PanelToggleIcon } from "../components/icons.tsx";
import {
  Menu,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../components/menu.tsx";
import { focus, IconButton, ToggleIconButton } from "../components/ui";
import { parseUnifiedPatch } from "../conversation/tool-detail.ts";
import { refreshVcs, useSessionSnapshot, useVcsDiffs, useVcsSnapshot } from "../queries.ts";
import { control, workbench } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import { turnChangeOptions, turnHasChanges, visibleTurnOptions } from "./change-scopes.ts";
import {
  changeFileGroups,
  changeFileTone,
  filesChangedLabel,
  visibleChangeTreeRows,
} from "./change-tree.ts";
import type { ChangeFileTone } from "./change-tree.ts";
import { ChangesStack, changesStackItem, stackFonts } from "./changes-stack.tsx";
import type { WorkbenchChangesScope } from "./controller.ts";
import { parseCachedDiff } from "./diff-cache.ts";
import { pretextFitsWidth, pretextNaturalWidth, truncateMiddleText } from "./pretext.ts";
import {
  EMPTY_PATCH,
  diffMarksWidth,
  railLabelMaxWidth,
  railRowWidth,
  uncommittedStackSection,
  type ChangeStackSection,
  type UncommittedPatch,
} from "./stacked-diff.ts";
import { useClientBox } from "./use-client-box.ts";

type StatusFile = VcsStatus["files"][number];

interface UncommittedChangeRow {
  readonly source: "uncommitted";
  readonly path: string;
  readonly status: StatusFile["kind"];
  readonly inWorkingTree: boolean;
  readonly change: FileChange | undefined;
}

interface TurnChangeRow {
  readonly source: "turn";
  readonly path: string;
  readonly change: FileChange;
  readonly patch: string;
}

type ChangeRow = UncommittedChangeRow | TurnChangeRow;

const EMPTY_TURNS: readonly Turn[] = [];
const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
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
    maxWidth: "calc(100% - 72px)",
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
  scopeChevron: { display: "inline-flex", flexShrink: 0, color: t.iconTertiary },
  scopeMenu: {
    maxHeight: `min(${control.menuMaxHeight}, var(--available-height))`,
  },
  toolbarSpacer: { flex: 1, minWidth: 0 },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  files: {
    order: 1,
    width: workbench.fileListWidth,
    flexShrink: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: 5,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeTertiary,
    backgroundColor: t.bgSubtle,
  },
  filesHidden: { display: "none" },
  file: {
    appearance: "none",
    display: "flex",
    alignItems: "center",
    gap: 5,
    width: "100%",
    height: 24,
    paddingInline: 6,
    borderRadius: t.radiusBase,
    borderStyle: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textAlign: "left",
    cursor: "pointer",
  },
  fileSelected: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
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
  overviewTitle: {
    display: "flex",
    alignItems: "center",
    height: 24,
    paddingInline: 6,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontWeight: 590,
  },
  filePath: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  fileStat: {
    display: "inline-flex",
    gap: 3,
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
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: 20,
    color: t.textTertiary,
    fontSize: t.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

function queryError(error: Error | null): string | undefined {
  if (error === null) return undefined;
  const message = error.message;
  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

function scopeValue(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "uncommitted";
    case "turn":
      return `turn:${scope.turnId}`;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

function ChangeStats({
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

function scopeStats(rows: readonly ChangeRow[]) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.change === undefined) continue;
    added += row.change.added;
    removed += row.change.removed;
  }
  return { added, removed };
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

function ScopeMeta({ rows }: { readonly rows: readonly ChangeRow[] }): ReactElement {
  const stats = scopeStats(rows);
  return stats.added > 0 || stats.removed > 0 ? (
    <ChangeStats {...stats} />
  ) : (
    <span {...stylex.props(styles.scopeCount)}>
      {String(rows.length)} {rows.length === 1 ? "file" : "files"}
    </span>
  );
}

function uncommittedPatchState(
  row: UncommittedChangeRow,
  patch: string | undefined,
  diffs: { readonly isLoading: boolean; readonly isError: boolean },
): UncommittedPatch {
  if (!row.inWorkingTree) return { kind: "absent" };
  if (patch !== undefined && patch.trim() !== "") return { kind: "ready", patch };
  if (diffs.isError) return { kind: "failed" };
  if (diffs.isLoading) return { kind: "pending" };
  return { kind: "empty" };
}

function changeRows(
  status: VcsStatus | undefined,
  declared: readonly FileChange[],
): readonly UncommittedChangeRow[] {
  const remaining = new Map(declared.map((change) => [change.path, change]));
  const rows = (status?.files ?? []).map((file): UncommittedChangeRow => {
    const change = remaining.get(file.path);
    remaining.delete(file.path);
    return {
      source: "uncommitted",
      path: file.path,
      status: file.kind,
      inWorkingTree: true,
      change,
    };
  });
  for (const change of remaining.values()) {
    rows.push({
      source: "uncommitted",
      path: change.path,
      status: "modified",
      inWorkingTree: false,
      change,
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

interface ChangesPanelProps {
  readonly sessionId: SessionId | undefined;
  readonly scope: WorkbenchChangesScope;
  readonly selectedPath: string | undefined;
  readonly revealPathRevision: number;
  readonly scrollTop: number;
  readonly fileTreeVisible: boolean;
  readonly onScopeChange: (scope: WorkbenchChangesScope) => void;
  readonly onToggleFileTree: () => void;
  readonly onSelectPath: (path: string | undefined) => void;
  readonly onRevealPath: (path: string) => void;
  readonly onScrollTop: (scrollTop: number) => void;
}

interface ChangesPanelViewProps extends Omit<ChangesPanelProps, "sessionId"> {
  readonly turns: readonly Turn[];
  readonly turnsError: Error | null;
}

function ChangesPanelView({
  scope,
  selectedPath,
  revealPathRevision,
  scrollTop,
  fileTreeVisible,
  onScopeChange,
  onToggleFileTree,
  onSelectPath,
  onRevealPath,
  onScrollTop,
  turns,
  turnsError,
}: ChangesPanelViewProps): ReactElement {
  // The declared changes are a fold of the transcript this panel already
  // holds; asking the session for them again would reread the whole branch.
  const declared = useMemo(() => changesFromTurns(turns), [turns]);
  const snapshot = useVcsSnapshot(true);
  const status = snapshot.data?.status;
  const turnOptions = useMemo(() => turnChangeOptions(turns), [turns]);
  const [showAllTurns, setShowAllTurns] = useState(false);
  const selectedTurn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;
  const visibleTurns = visibleTurnOptions(turnOptions, showAllTurns, selectedTurn?.scope.turnId);
  const hasEmptyTurns = turnOptions.some((option) => !turnHasChanges(option));
  const activeScope = selectedTurn?.scope ?? UNCOMMITTED_SCOPE;
  const uncommittedRows = useMemo(() => changeRows(status, declared), [declared, status]);
  const rows: readonly ChangeRow[] =
    selectedTurn === undefined
      ? uncommittedRows
      : selectedTurn.files.map(({ change, patch }): TurnChangeRow => ({
          source: "turn",
          path: change.path,
          change,
          patch,
        }));
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const paths = rows.map((row) => row.path);
  const groups = changeFileGroups(paths);
  const treeRows = visibleChangeTreeRows({ groups, collapsed });
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const groupByPath = new Map(groups.map((group) => [group.path, group]));
  const stackOrder = groups.flatMap((group) => group.files);
  const activePath = stackOrder.includes(selectedPath ?? "") ? selectedPath : stackOrder[0];
  const workingPaths = useMemo(
    () => uncommittedRows.filter((row) => row.inWorkingTree).map((row) => row.path),
    [uncommittedRows],
  );
  const diffsIdentity =
    snapshot.data?.kind === "repository" && selectedTurn === undefined
      ? {
          repositoryId: snapshot.data.repositoryId,
          revision: snapshot.data.revision,
          paths: workingPaths,
        }
      : undefined;
  const diffs = useVcsDiffs(diffsIdentity, selectedTurn === undefined);
  const patchByPath = new Map((diffs.data ?? []).map((item) => [item.path, item.patch]));
  const items = stackOrder.map((path) => {
    const row = rowByPath.get(path);
    if (row === undefined) {
      return changesStackItem(
        { kind: "notice", path, text: EMPTY_PATCH },
        { added: 0, removed: 0 },
        undefined,
      );
    }
    if (row.source === "turn") {
      const section: ChangeStackSection =
        row.patch.trim() === ""
          ? { kind: "notice", path, text: EMPTY_PATCH }
          : { kind: "diff", path, patch: row.patch };
      return changesStackItem(
        section,
        { added: row.change.added, removed: row.change.removed },
        section.kind === "diff" ? parseUnifiedPatch(row.patch) : undefined,
      );
    }
    const section = uncommittedStackSection({
      path,
      state: uncommittedPatchState(row, patchByPath.get(path), diffs),
    });
    const parsed =
      section.kind === "diff" && snapshot.data?.kind === "repository"
        ? parseCachedDiff(
            {
              repositoryId: snapshot.data.repositoryId,
              revision: snapshot.data.revision,
              path,
            },
            section.patch,
          )
        : section.kind === "diff"
          ? parseUnifiedPatch(section.patch)
          : undefined;
    return changesStackItem(
      section,
      {
        added: row.change?.added ?? parsed?.added ?? 0,
        removed: row.change?.removed ?? parsed?.removed ?? 0,
      },
      parsed,
    );
  });
  const toggleDirectory = (path: string): void => {
    setCollapsed((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  };
  const vcsError = queryError(snapshot.error);
  const transcriptError = queryError(turnsError);
  // Each scope blames its own source first and falls back to the other, so no
  // failure is ever dropped. A turn diff is built from the transcript alone, so
  // the Git advice never explains a missing turn. Uncommitted rows come from the
  // working tree, folded with the changes turns declare, so both reads matter.
  const vcsFailure =
    vcsError === undefined
      ? undefined
      : {
          text: "Couldn't read changes. Check that this folder is a Git repository.",
          detail: vcsError,
        };
  const transcriptFailure =
    transcriptError === undefined
      ? undefined
      : { text: "Couldn't read this conversation's changes.", detail: transcriptError };
  const readFailure =
    scope.kind === "turn" ? (transcriptFailure ?? vcsFailure) : (vcsFailure ?? transcriptFailure);
  // The turn's own files are loaded, so its emptiness is a fact that a stale
  // background failure cannot change.
  const emptyState: { readonly text: string; readonly detail?: string } =
    selectedTurn !== undefined
      ? { text: "This turn made no file changes" }
      : (readFailure ?? { text: "Working tree is clean" });
  const activeScopeValue = scopeValue(activeScope);
  const activeLabel = selectedTurn?.label ?? "Uncommitted";
  const appearance = useAppearanceSettings();
  const [attachFiles, filesWidth] = useClientBox();
  const fonts = stackFonts(appearance);
  const rowWidth = railRowWidth(filesWidth);

  return (
    <section {...stylex.props(styles.panel)} aria-label="Workspace changes">
      <FileTypeIconSprite />
      <Toolbar.Root aria-label="Changes actions" {...stylex.props(styles.toolbar)}>
        <Menu
          label="Select changes"
          popupStyle={styles.scopeMenu}
          trigger={
            <BaseButton
              unstyled
              type="button"
              aria-label={`Showing ${activeLabel}`}
              {...stylex.props(styles.scopeTrigger, focus.ring)}
            >
              <Icon name={selectedTurn === undefined ? "file" : "git-branch"} size={14} />
              <span {...stylex.props(styles.scopeLabel)}>{activeLabel}</span>
              {selectedTurn === undefined ? (
                <ScopeMeta rows={uncommittedRows} />
              ) : (
                <ChangeStats key={activeScopeValue} {...selectedTurn.stats} />
              )}
              <span {...stylex.props(styles.scopeChevron)}>
                <Icon name="chevron-down" size={10} />
              </span>
            </BaseButton>
          }
        >
          <MenuRadioGroup
            value={activeScopeValue}
            onValueChange={(value) => {
              if (value === scopeValue(UNCOMMITTED_SCOPE)) {
                onScopeChange(UNCOMMITTED_SCOPE);
                return;
              }
              const option = turnOptions.find((candidate) => scopeValue(candidate.scope) === value);
              if (option !== undefined) onScopeChange(option.scope);
            }}
          >
            <MenuRadioItem
              value={scopeValue(UNCOMMITTED_SCOPE)}
              icon="file"
              meta={<ScopeMeta rows={uncommittedRows} />}
            >
              Uncommitted
            </MenuRadioItem>
            {visibleTurns.length > 0 && <MenuSeparator />}
            {visibleTurns.map((option) => (
              <MenuRadioItem
                key={option.scope.turnId}
                value={scopeValue(option.scope)}
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
        <span {...stylex.props(styles.toolbarSpacer)} />
        <Toolbar.Button
          render={<IconButton icon="refresh" label="Refresh changes" onClick={refreshVcs} />}
        />
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
      {rows.length === 0 ? (
        <div
          role={emptyState.detail === undefined ? "status" : "alert"}
          title={emptyState.detail}
          {...stylex.props(styles.empty)}
        >
          {emptyState.text}
        </div>
      ) : (
        <div {...stylex.props(styles.body)}>
          <div
            ref={attachFiles}
            role="tree"
            aria-label="Changed files"
            data-nyte-scrollport
            {...stylex.props(styles.files, !fileTreeVisible && styles.filesHidden)}
          >
            <div {...stylex.props(styles.overviewTitle)}>{filesChangedLabel(rows.length)}</div>
            {treeRows.map((entry) => {
              const row = rowByPath.get(entry.path);
              const group = groupByPath.get(entry.path);
              const tone =
                row === undefined
                  ? undefined
                  : row.source === "uncommitted"
                    ? changeFileTone({ status: row.status })
                    : changeFileTone({ added: row.change.added, removed: row.change.removed });
              const expanded = entry.kind === "directory" && !collapsed.includes(entry.path);
              const groupStats =
                group === undefined
                  ? { added: 0, removed: 0 }
                  : scopeStats(
                      group.files.flatMap((path) => {
                        const file = rowByPath.get(path);
                        return file === undefined ? [] : [file];
                      }),
                    );
              const marks =
                entry.kind === "directory"
                  ? groupStats
                  : { added: row?.change?.added ?? 0, removed: row?.change?.removed ?? 0 };
              const statsWidth =
                rowWidth === 0
                  ? 0
                  : diffMarksWidth({
                      added: marks.added,
                      removed: marks.removed,
                      measure: (text) => pretextNaturalWidth(text, fonts.xs),
                    });
              const labelWidth = railLabelMaxWidth({
                rowWidth,
                depth: entry.depth,
                statsWidth,
                hasPip: entry.kind === "file",
              });
              const label = truncateMiddleText({
                text: entry.label,
                maxWidth: labelWidth,
                fits: (value) =>
                  labelWidth <= 0 ? true : pretextFitsWidth(value, fonts.ui, labelWidth),
              });
              return (
                <button
                  key={entry.path}
                  type="button"
                  role="treeitem"
                  title={entry.path}
                  aria-expanded={entry.kind === "directory" ? expanded : undefined}
                  aria-selected={entry.kind === "file" ? entry.path === activePath : undefined}
                  {...stylex.props(
                    styles.file,
                    focus.ringInset,
                    entry.kind === "directory" && styles.folder,
                    entry.kind === "file" && entry.path === activePath && styles.fileSelected,
                  )}
                  onClick={() => {
                    if (entry.kind === "directory") {
                      toggleDirectory(entry.path);
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
                      tone === "added" && styles.nameAdded,
                      tone === "deleted" && styles.nameDeleted,
                      tone === "modified" && styles.nameModified,
                    )}
                  >
                    {label}
                  </span>
                  <DiffMarks key={activeScopeValue} added={marks.added} removed={marks.removed} />
                  {entry.kind === "file" && <StatusPip tone={tone} />}
                </button>
              );
            })}
          </div>
          <ChangesStack
            key={activeScopeValue}
            items={items}
            scrollTop={scrollTop}
            focusPath={activePath}
            focusRevision={revealPathRevision}
            onScrollTop={onScrollTop}
            onActivePath={onSelectPath}
          />
        </div>
      )}
    </section>
  );
}

function SessionChangesPanel(
  props: ChangesPanelProps & { readonly sessionId: SessionId },
): ReactElement {
  const snapshot = useSessionSnapshot(props.sessionId);
  return (
    <ChangesPanelView
      {...props}
      turns={snapshot.data?.transcript ?? EMPTY_TURNS}
      turnsError={snapshot.error}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  return props.sessionId === undefined ? (
    <ChangesPanelView {...props} turns={EMPTY_TURNS} turnsError={null} />
  ) : (
    <SessionChangesPanel {...props} sessionId={props.sessionId} />
  );
}
