/** Local working-tree, commit and per-turn declared changes. GitHub never participates in this path. */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { FileChange, SessionId, Turn, VcsStatus } from "@nyte-ai/core";
import { changesFromTurns } from "@nyte-ai/core/views";
import { FileTypeIconSprite } from "../components/file-type-icon";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { createDiffFilesLoader } from "../conversation/diff-expansion.ts";
import { parseUnifiedPatch } from "../conversation/tool-detail.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { refreshVcs, useSessionSnapshot, useVcsScopedDiffs, useVcsSnapshot } from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import {
  branchReadout,
  changesScopeLabel,
  changesScopeValue,
  diffRequestForScope,
  turnChangeOptions,
  turnScopeOption,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import { changeFileGroups, changeFileTone } from "./change-tree.ts";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import { ChangesStack, changesStackItem, stackFonts } from "./changes-stack.tsx";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import { changesViewOptions } from "./changes-view-options.ts";
import { changesViewed, patchDigest } from "./changes-viewed.ts";
import type { ViewedFile, ViewedState } from "./changes-viewed.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import { parseCachedDiff } from "./diff-cache.ts";
import {
  EMPTY_PATCH,
  uncommittedStackSection,
  type ChangeStackSection,
  type UncommittedPatch,
} from "./stacked-diff.ts";

type StatusFile = VcsStatus["files"][number];

/** A file the working tree or the index reports, folded with what turns declared. */
interface WorkingChangeRow {
  readonly source: "working";
  readonly path: string;
  readonly status: StatusFile["kind"];
  readonly inWorkingTree: boolean;
  readonly change: FileChange | undefined;
}

/** A file whose patch is the record: a turn's edit, or one commit's diff. */
interface PatchChangeRow {
  readonly source: "patch";
  readonly path: string;
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

type ChangeRow = WorkingChangeRow | PatchChangeRow;

const EMPTY_TURNS: readonly Turn[] = [];
const EMPTY_ROWS: readonly WorkingChangeRow[] = [];
const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const NO_COLLAPSED_PATHS: readonly string[] = [];

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
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

function uncommittedPatchState(
  row: WorkingChangeRow,
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
  files: VcsStatus["files"] | undefined,
  declared: readonly FileChange[],
): readonly WorkingChangeRow[] {
  const remaining = new Map(declared.map((change) => [change.path, change]));
  const rows = (files ?? []).map((file): WorkingChangeRow => {
    const change = remaining.get(file.path);
    remaining.delete(file.path);
    return { source: "working", path: file.path, status: file.kind, inWorkingTree: true, change };
  });
  for (const change of remaining.values()) {
    rows.push({
      source: "working",
      path: change.path,
      status: "modified",
      inWorkingTree: false,
      change,
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function emptyScopeText(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "staged":
      return "Nothing is staged";
    case "unstaged":
      return "No unstaged changes";
    case "commit":
      return "This commit changed no files";
    default:
      return "Working tree is clean";
  }
}

/** The file a confirmation is about, and whether reverting it means the trash. */
export interface RevertTarget {
  readonly path: string;
  readonly untracked: boolean;
}

/**
 * A tracked file goes back to its committed state, which nothing can undo. An
 * untracked file has no committed state to return to, so it is trashed instead
 * and the copy says so rather than claiming the change is unrecoverable.
 */
export function revertConfirmation(target: RevertTarget): {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
} {
  if (target.untracked) {
    return {
      title: "Move to Trash?",
      description: `${target.path} is untracked, so reverting it moves the file to the trash.`,
      confirmLabel: "Move to Trash",
      pendingLabel: "Moving…",
    };
  }
  return {
    title: "Revert changes?",
    description: `${target.path} goes back to the last commit, and its changes are lost. This can’t be undone.`,
    confirmLabel: "Revert",
    pendingLabel: "Reverting…",
  };
}

/**
 * The rail owns the only search surface, so the toolbar's filter command goes
 * through the field the rail renders rather than a second copy of its state.
 */
function focusFileFilter(panel: HTMLElement | null): void {
  const field = panel?.querySelector('input[aria-label="Filter changed files"]');
  if (!(field instanceof HTMLInputElement)) return;
  field.focus();
  field.select();
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
  /**
   * Discards a file's working-tree changes. The panel confirms and reverts on
   * its own when this is unset; a host that supplies it owns the confirmation.
   */
  readonly onRevertPath?: (path: string) => void;
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
  onRevertPath,
  turns,
  turnsError,
}: ChangesPanelViewProps): ReactElement {
  // The declared changes are a fold of the transcript this panel already
  // holds; asking the session for them again would reread the whole branch.
  const declared = useMemo(() => changesFromTurns(turns), [turns]);
  const snapshot = useVcsSnapshot(true);
  const turnOptions = useMemo(() => turnChangeOptions(turns), [turns]);
  const panelRef = useRef<HTMLElement | null>(null);
  // The affordance that opened the confirmation, so closing it returns focus there.
  const revertReturnRef = useRef<HTMLButtonElement | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | undefined>(undefined);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>(undefined);
  const [filterFocusRevision, setFilterFocusRevision] = useState(0);
  // Collapse state belongs to the panel so the toolbar can command it, but it
  // describes one scope's files: switching scope starts over rather than
  // collapsing same-named files in the scope that replaced them.
  const [collapsedSections, setCollapsedSections] = useState<{
    readonly scope: string;
    readonly paths: readonly string[];
  }>({ scope: "", paths: NO_COLLAPSED_PATHS });
  const selectedTurn =
    scope.kind === "turn"
      ? turnOptions.find((option) => option.scope.turnId === scope.turnId)
      : undefined;
  // A stored turn the transcript no longer holds collapses to the working tree.
  const activeScope: WorkbenchChangesScope =
    scope.kind === "turn" && selectedTurn === undefined ? UNCOMMITTED_SCOPE : scope;
  const activeScopeValue = changesScopeValue(activeScope);
  const repositoryId =
    snapshot.data?.kind === "repository" ? snapshot.data.repositoryId : undefined;
  const revision = snapshot.data?.kind === "repository" ? snapshot.data.revision : undefined;
  const repository =
    repositoryId === undefined || revision === undefined ? undefined : { repositoryId, revision };
  useSyncExternalStore(
    changesViewed.subscribe,
    changesViewed.getSnapshot,
    changesViewed.getSnapshot,
  );
  useSyncExternalStore(
    changesViewOptions.subscribe,
    changesViewOptions.getSnapshot,
    changesViewOptions.getSnapshot,
  );
  // Options follow the repository; a turn shares the layout chosen for the tree
  // it belongs to. Review marks do not: the same path carries a different patch
  // in each scope, and a mark from one must not read as stale in another.
  const optionsScopeId = repositoryId ?? "workspace";
  const options = changesViewOptions.options(optionsScopeId);

  const statusFiles =
    activeScope.kind === "staged"
      ? snapshot.data?.staged
      : activeScope.kind === "unstaged"
        ? snapshot.data?.unstaged
        : snapshot.data?.status.files;
  const workingScope = activeScope.kind !== "turn" && activeScope.kind !== "commit";
  const workingRows = useMemo(
    () =>
      workingScope
        ? changeRows(statusFiles, activeScope.kind === "uncommitted" ? declared : [])
        : EMPTY_ROWS,
    [activeScope.kind, declared, statusFiles, workingScope],
  );
  const workingPaths = workingRows.filter((row) => row.inWorkingTree).map((row) => row.path);
  const diffRequest = diffRequestForScope(activeScope, {
    paths: workingScope ? workingPaths : undefined,
    ignoreWhitespace: options.ignoreWhitespace,
  });
  const diffs = useVcsScopedDiffs(
    repository === undefined || diffRequest === undefined
      ? undefined
      : { ...repository, request: diffRequest },
    !workingScope || workingPaths.length > 0,
  );
  const patchByPath = new Map((diffs.data ?? []).map((item) => [item.path, item.patch]));
  // Whitespace and the scope change the bytes of a patch for the same revision
  // and path, so the parse cache is keyed by the read that produced it.
  const diffRevision = `${revision ?? ""}\u0000${activeScopeValue}\u0000${options.ignoreWhitespace ? "ignore-ws" : "raw"}`;
  const parseDiff = (path: string, patch: string) =>
    repositoryId === undefined
      ? parseUnifiedPatch(patch)
      : parseCachedDiff({ repositoryId, revision: diffRevision, path }, patch);

  const patchRows: readonly PatchChangeRow[] =
    selectedTurn !== undefined
      ? selectedTurn.files.map(({ change, patch }): PatchChangeRow => ({
          source: "patch",
          path: change.path,
          patch,
          added: change.added,
          removed: change.removed,
        }))
      : activeScope.kind === "commit"
        ? (diffs.data ?? []).map((diff): PatchChangeRow => {
            const parsed = parseDiff(diff.path, diff.patch);
            return {
              source: "patch",
              path: diff.path,
              patch: diff.patch,
              added: parsed?.added ?? 0,
              removed: parsed?.removed ?? 0,
            };
          })
        : [];
  const rows: readonly ChangeRow[] = workingScope ? workingRows : patchRows;
  const groups = changeFileGroups(rows.map((row) => row.path));
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const stackOrder = groups.flatMap((group) => group.files);
  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;
  const allCollapsed =
    stackOrder.length > 0 && stackOrder.every((path) => collapsedPaths.includes(path));
  const activePath = stackOrder.includes(selectedPath ?? "") ? selectedPath : stackOrder[0];
  const sections = stackOrder.map((path) => {
    const row = rowByPath.get(path);
    if (row === undefined) {
      return changesStackItem(
        { kind: "notice", path, text: EMPTY_PATCH },
        { added: 0, removed: 0 },
        undefined,
      );
    }
    if (row.source === "patch") {
      const section: ChangeStackSection =
        row.patch.trim() === ""
          ? { kind: "notice", path, text: EMPTY_PATCH }
          : { kind: "diff", path, patch: row.patch };
      return changesStackItem(
        section,
        { added: row.added, removed: row.removed },
        section.kind === "diff" ? parseDiff(path, row.patch) : undefined,
      );
    }
    const section = uncommittedStackSection({
      path,
      state: uncommittedPatchState(row, patchByPath.get(path), diffs),
    });
    const parsed = section.kind === "diff" ? parseDiff(path, section.patch) : undefined;
    return changesStackItem(
      section,
      {
        added: row.change?.added ?? parsed?.added ?? 0,
        removed: row.change?.removed ?? parsed?.removed ?? 0,
      },
      parsed,
    );
  });
  // A review mark records the patch that was read, so the digest is taken from
  // the section the stack renders rather than from the raw working-tree diff.
  const viewedFiles: readonly ViewedFile[] = sections.map((section) => ({
    path: section.path,
    digest: patchDigest(
      section.kind === "diff" ? section.patch : section.kind === "pending" ? "" : section.text,
    ),
  }));
  const digestByPath = new Map(viewedFiles.map((file) => [file.path, file.digest]));
  const vcsError = queryError(snapshot.error);
  const transcriptError = queryError(turnsError);
  // Each scope blames its own source first and falls back to the other, so no
  // failure is ever dropped. A turn diff is built from the transcript alone, so
  // the Git advice never explains a missing turn. Working-tree rows come from the
  // repository, folded with the changes turns declare, so both reads matter.
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
      : (readFailure ?? { text: emptyScopeText(activeScope) });
  const appearance = useAppearanceSettings();
  const fonts = stackFonts(appearance);
  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;
  const viewedFileByPath = new Map(viewedFiles.map((file) => [file.path, file]));
  const viewedState = (path: string): ViewedState => {
    const file = viewedFileByPath.get(path);
    return file === undefined ? "unviewed" : changesViewed.fileState(viewedScopeId, file);
  };
  const setViewed = (paths: readonly string[], viewed: boolean): void => {
    if (viewed) {
      changesViewed.markAllViewed(
        viewedScopeId,
        paths.flatMap((path) => {
          const digest = digestByPath.get(path);
          return digest === undefined ? [] : [{ path, digest }];
        }),
      );
      return;
    }
    changesViewed.clearAllViewed(viewedScopeId, paths);
  };
  // Only a working tree has both sides of a file to widen a gap with. A turn's
  // patch and a commit's are records of an edit, and the files have moved on.
  const expandable = repository !== undefined && workingScope;
  const loadDiffFiles = useMemo(
    () =>
      expandable && repositoryId !== undefined && revision !== undefined
        ? createDiffFilesLoader({
            readContents: (input) => nyte.host.vcs.contents(input),
            repositoryId,
            revision,
            base: "head",
          })
        : undefined,
    [expandable, repositoryId, revision],
  );
  const sidebarFiles: readonly ChangesSidebarFile[] = stackOrder.flatMap((path) => {
    const row = rowByPath.get(path);
    if (row === undefined) return [];
    const stats =
      row.source === "working"
        ? { added: row.change?.added ?? 0, removed: row.change?.removed ?? 0 }
        : { added: row.added, removed: row.removed };
    return [
      {
        path,
        status: row.source === "working" ? row.status : undefined,
        tone:
          row.source === "working" ? changeFileTone({ status: row.status }) : changeFileTone(stats),
        added: stats.added,
        removed: stats.removed,
        viewed: viewedState(path),
      },
    ];
  });
  const scopeStats = sections.reduce(
    (total, section) => ({
      added: total.added + section.added,
      removed: total.removed + section.removed,
    }),
    { added: 0, removed: 0 },
  );

  const filterFiles = (): void => {
    // The rail is display:none while the tree is hidden, so it has to be shown
    // before its field can take focus; the effect below waits for that render.
    if (!fileTreeVisible) onToggleFileTree();
    setFilterFocusRevision((revision) => revision + 1);
  };

  // Only a working tree has a state to go back to: a turn's patch and a
  // commit's are records, and the file has moved on since.
  const askToRevert = (path: string): void => {
    const row = rowByPath.get(path);
    if (row === undefined || row.source !== "working") return;
    const opener = document.activeElement;
    revertReturnRef.current = opener instanceof HTMLButtonElement ? opener : null;
    setRevertError(undefined);
    setRevertTarget({ path, untracked: row.status === "untracked" });
  };
  const revertPath = workingScope ? (onRevertPath ?? askToRevert) : undefined;
  const confirmRevert = async (target: RevertTarget): Promise<void> => {
    setReverting(true);
    setRevertError(undefined);
    try {
      const result = await nyte.host.vcs.revert({ paths: [target.path] });
      const skipped = result.skipped.find((entry) => entry.path === target.path);
      if (skipped !== undefined) {
        setRevertError(skipped.reason);
        return;
      }
      // The file no longer has the patch its review mark was filed under.
      changesViewed.clearViewed(viewedScopeId, target.path);
      refreshVcs();
      setRevertTarget(undefined);
    } catch (error) {
      setRevertError(error instanceof Error ? error.message : "Couldn’t revert this file.");
    } finally {
      setReverting(false);
    }
  };
  const revertCopy = revertConfirmation(revertTarget ?? { path: "", untracked: false });
  const toggleCollapseAll = (): void => {
    setCollapsedSections({
      scope: activeScopeValue,
      paths: allCollapsed ? NO_COLLAPSED_PATHS : stackOrder,
    });
  };
  const toggleCollapsedPath = (path: string): void => {
    setCollapsedSections((current) => {
      const paths = current.scope === activeScopeValue ? current.paths : NO_COLLAPSED_PATHS;
      return {
        scope: activeScopeValue,
        paths: paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path],
      };
    });
  };
  useEffect(() => {
    if (filterFocusRevision === 0 || !fileTreeVisible) return;
    focusFileFilter(panelRef.current);
  }, [fileTreeVisible, filterFocusRevision]);

  return (
    <section
      ref={panelRef}
      {...stylex.props(styles.panel)}
      aria-label="Workspace changes"
      onKeyDown={(event) => {
        const action = changesShortcutAction(event.nativeEvent, macPlatform(undefined));
        if (action === undefined) return;
        event.preventDefault();
        if (action === "filter-files") {
          filterFiles();
          return;
        }
        if (action === "refresh") {
          refreshVcs();
          return;
        }
        changesViewOptions.setOptions(optionsScopeId, {
          ignoreWhitespace: !options.ignoreWhitespace,
        });
      }}
    >
      <FileTypeIconSprite />
      <ChangesToolbar
        scope={activeScope}
        scopeLabel={changesScopeLabel(activeScope, [
          ...workingTreeScopeOptions(snapshot.data),
          ...turnOptions.map(turnScopeOption),
        ])}
        scopeStats={scopeStats}
        scopeFileCount={rows.length}
        snapshot={snapshot.data}
        repository={repository}
        branch={branchReadout(snapshot.data)}
        turnOptions={turnOptions}
        viewOptions={options}
        fileTreeVisible={fileTreeVisible}
        onScopeChange={onScopeChange}
        onViewOptionsChange={(changes) => {
          changesViewOptions.setOptions(optionsScopeId, changes);
        }}
        onToggleFileTree={onToggleFileTree}
        onRefresh={refreshVcs}
        onFilterFiles={filterFiles}
        allFilesCollapsed={allCollapsed}
        onToggleCollapseAll={toggleCollapseAll}
      />
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
          <ChangesSidebar
            key={activeScopeValue}
            files={sidebarFiles}
            visible={fileTreeVisible}
            activePath={activePath}
            statsKey={activeScopeValue}
            fonts={fonts}
            onRevealPath={onRevealPath}
            onRevertPath={revertPath}
            onViewedChange={(path, viewed) => {
              setViewed([path], viewed);
            }}
            onAllViewedChange={setViewed}
          />
          <ChangesStack
            key={activeScopeValue}
            items={sections}
            collapsedPaths={collapsedPaths}
            onToggleCollapsed={toggleCollapsedPath}
            scrollTop={scrollTop}
            focusPath={activePath}
            focusRevision={revealPathRevision}
            layout={options.layout}
            wordWrap={options.wordWrap}
            loadDiffFiles={loadDiffFiles}
            viewedState={viewedState}
            onViewedChange={(path, viewed) => {
              setViewed([path], viewed);
            }}
            onRevertPath={revertPath}
            onScrollTop={onScrollTop}
            onActivePath={onSelectPath}
          />
        </div>
      )}
      <ConfirmDialog
        open={revertTarget !== undefined}
        pending={reverting}
        error={revertError}
        returnFocusRef={revertReturnRef}
        title={revertCopy.title}
        description={revertCopy.description}
        confirmLabel={revertCopy.confirmLabel}
        pendingLabel={revertCopy.pendingLabel}
        onOpenChange={(open) => {
          if (!open) setRevertTarget(undefined);
        }}
        onConfirm={() => {
          if (revertTarget !== undefined) void confirmRevert(revertTarget);
        }}
      />
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
