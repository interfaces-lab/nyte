import { create, props } from "@stylexjs/stylex";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement } from "react";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { RunId, SessionId, Turn, VcsFileKind, VcsLineStat } from "@nyte-ai/protocol";
import { FileTypeIconSprite } from "../components/file-type-icon";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { createDiffFilesLoader } from "../conversation/diff-expansion.ts";
import { nyte } from "../nyte.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { macPlatform } from "../platform.ts";
import {
  refreshVcs,
  useRunDiff,
  useSessionSnapshot,
  useVcsChanges,
  useVcsSnapshot,
  vcsReadKey,
} from "../queries.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import {
  branchReadout,
  changesRepository,
  changesScopeLabel,
  changesScopeValue,
  scopeFiles,
  turnChangeOptions,
  turnScopeOption,
  vcsRequestForScope,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import { preferences, useSetting } from "../preferences/index.ts";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import { createPatchLoader } from "./changes-patches.ts";
import type { PatchEntry, PatchSource } from "./changes-patches.ts";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import { changesViewOptions, useChangesViewOptions } from "./changes-view-options.ts";
import { changesViewed, patchDigest } from "./changes-viewed.ts";
import type { ViewedState } from "./changes-viewed.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import { EMPTY_PATCH, patchStackSection } from "./stacked-diff.ts";

/** A file Git reports: from status in a working scope, from the manifest for a commit. */
interface VcsChangeRow {
  readonly source: "working" | "commit";
  readonly path: string;
  readonly status: VcsFileKind;
}

/** A file whose patch is the record: one turn's edit. */
interface RecordedChangeRow {
  readonly source: "recorded";
  readonly path: string;
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

type ChangeRow = VcsChangeRow | RecordedChangeRow;

const EMPTY_TURNS: readonly Turn[] = [];

const EMPTY_ROWS: readonly VcsChangeRow[] = [];

const EMPTY_RECORDED: readonly RecordedChangeRow[] = [];

const UNKNOWN_STAT: VcsLineStat = { kind: "unknown" };

/**
 * Each set of a turn's recorded rows is one state of that turn's patches, so a
 * live turn's next answer reads as a new state rather than as the same one.
 */
const recordedVersions = new WeakMap<readonly RecordedChangeRow[], number>();

let nextRecordedVersion = 0;

function recordedVersion(rows: readonly RecordedChangeRow[]): number {
  const known = recordedVersions.get(rows);

  if (known !== undefined) return known;
  nextRecordedVersion += 1;
  recordedVersions.set(rows, nextRecordedVersion);

  return nextRecordedVersion;
}

/** What a review mark records for an entry; an unreadable patch has nothing to record. */
function viewedDigest(entry: PatchEntry): string | undefined {
  switch (entry.kind) {
    case "ready":
    case "binary":
      return entry.digest;
    case "empty":
      return patchDigest(EMPTY_PATCH);
    case "too_large":
    case "failed":
      return undefined;
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

function entryStat(entry: PatchEntry): VcsLineStat | undefined {
  switch (entry.kind) {
    case "ready":
      return { kind: "text", added: entry.added, removed: entry.removed };
    case "binary":
      return { kind: "binary" };
    case "empty":
      return { kind: "text", added: 0, removed: 0 };
    case "too_large":
    case "failed":
      return undefined;
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}

const UNCOMMITTED_SCOPE: WorkbenchChangesScope = { kind: "uncommitted" };

const NO_COLLAPSED_PATHS: readonly string[] = [];

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  unmarked: {
    paddingBlock: 6,
    paddingInline: 12,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textWrap: "pretty",
  },
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: 20,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

function queryError(error: Error | null): string | undefined {
  if (error === null) return undefined;
  const message = error.message;

  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

function emptyScopeText(scope: WorkbenchChangesScope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "Working tree is clean";
    case "staged":
      return "Nothing is staged";
    case "unstaged":
      return "No unstaged changes";
    case "turn":
      return "This turn made no file changes";
    case "commit":
      return "This commit changed no files";
    default: {
      const _exhaustive: never = scope;

      return _exhaustive;
    }
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
export function revertConfirmation(target: RevertTarget) {
  if (target.untracked) {
    return {
      title: "Move to Trash",
      description: `${target.path} is untracked, so reverting it moves the file to the trash.`,
      confirmLabel: "Move to Trash",
      pendingLabel: "Moving…",
    };
  }

  return {
    title: "Revert Changes",
    description: `${target.path} goes back to the last commit, and its changes are lost. This can’t be undone.`,
    confirmLabel: "Revert Changes",
    pendingLabel: "Reverting…",
  };
}

/**
 * The rail owns the only search surface, so the toolbar's filter command goes
 * through the field the rail renders rather than a second copy of its state.
 */
function focusFileFilter(field: HTMLInputElement | null): void {
  if (field === null) return;
  field.focus();
  field.select();
}

interface ChangesPanelProps {
  readonly visible?: boolean;
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

interface ChangesPanelViewProps extends ChangesPanelProps {
  readonly turns: readonly Turn[];
  readonly turnsError: Error | null;
  readonly liveRun: RunId | undefined;
}

function ChangesPanelView({
  visible = true,
  sessionId,
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
  liveRun,
}: ChangesPanelViewProps): ReactElement {
  const uiFontSize = useSetting(preferences.uiFontSize);
  const turnOptions = useMemo(() => turnChangeOptions(turns), [turns]);
  const snapshot = useVcsSnapshot(visible);
  const filterInput = useRef<HTMLInputElement>(null);
  // The affordance that opened the confirmation, so closing it returns focus there.
  const revertReturnRef = useRef<HTMLButtonElement | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | undefined>(undefined);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>(undefined);
  const [appliedReveal, setAppliedReveal] = useState({ scope: "", revision: 0 });

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
  const repository = changesRepository(snapshot.data);
  const root = repository?.root;
  const revision = repository?.revision;

  const viewedSnapshot = useSyncExternalStore(
    changesViewed.subscribe,
    changesViewed.getSnapshot,
    changesViewed.getSnapshot,
  );

  // Options follow the repository; a turn shares the layout chosen for the tree
  // it belongs to. Review marks do not: the same path carries a different patch
  // in each scope, and a mark from one must not read as stale in another.
  const optionsScopeId = root ?? "workspace";
  const options = useChangesViewOptions(optionsScopeId);

  const workingScope = activeScope.kind !== "turn" && activeScope.kind !== "commit";

  const statusFiles = useMemo(
    () =>
      activeScope.kind === "turn" || activeScope.kind === "commit"
        ? undefined
        : scopeFiles(snapshot.data, activeScope.kind),
    [snapshot.data, activeScope.kind],
  );

  const workingRows = useMemo(
    () =>
      statusFiles === undefined
        ? EMPTY_ROWS
        : statusFiles
            .map((file): VcsChangeRow => ({
              source: "working",
              path: file.path,
              status: file.kind,
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    [statusFiles],
  );

  const vcsRequest = vcsRequestForScope(activeScope, {
    ignoreWhitespace: options.ignoreWhitespace,
  });

  const vcsRead =
    repository === undefined || vcsRequest === undefined
      ? undefined
      : { ...repository, request: vcsRequest };

  // The manifest names a commit's files and counts every file's lines, without a patch.
  const manifest = useVcsChanges(vcsRead, visible && (!workingScope || workingRows.length > 0));

  const statByPath = useMemo(
    () => new Map((manifest.data ?? []).map((change) => [change.path, change.stat])),
    [manifest.data],
  );

  const commitRows = useMemo(
    (): readonly VcsChangeRow[] =>
      activeScope.kind === "commit"
        ? (manifest.data ?? []).map((change) => ({
            source: "commit",
            path: change.path,
            status: change.kind,
          }))
        : EMPTY_ROWS,
    [activeScope.kind, manifest.data],
  );

  const selectedRun = selectedTurn?.run.kind === "run" ? selectedTurn.run.id : undefined;

  const runDiff = useRunDiff({
    sessionId,
    runId: selectedRun,
    live: selectedRun !== undefined && selectedRun === liveRun,
    enabled: visible,
  });

  const runFiles =
    runDiff.data === undefined || runDiff.data.kind === "not_found"
      ? undefined
      : runDiff.data.files;

  const recordedRows = useMemo(
    (): readonly RecordedChangeRow[] =>
      selectedTurn === undefined
        ? EMPTY_RECORDED
        : runFiles !== undefined
          ? runFiles.map((file): RecordedChangeRow => ({
              source: "recorded",
              path: file.path,
              patch: file.patch,
              added: file.added,
              removed: file.removed,
            }))
          : selectedTurn.files.map(({ change, patch }): RecordedChangeRow => ({
              source: "recorded",
              path: change.path,
              patch,
              added: change.added,
              removed: change.removed,
            })),
    [selectedTurn, runFiles],
  );

  const rows: readonly ChangeRow[] = workingScope
    ? workingRows
    : selectedTurn !== undefined
      ? recordedRows
      : commitRows;

  const rowByPath = useMemo(() => new Map(rows.map((row) => [row.path, row])), [rows]);
  const stackOrder = useMemo(() => rows.map((row) => row.path), [rows]);

  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;

  const allCollapsed =
    stackOrder.length > 0 && stackOrder.every((path) => collapsedPaths.includes(path));

  const activePath = stackOrder.includes(selectedPath ?? "") ? selectedPath : stackOrder[0];

  // Every expanded file is read while the stack shows, nearest the file in
  // view first, alternating below and above it, so whichever way the reader
  // scrolls the next files are already read.
  const preparedPaths = useMemo((): readonly string[] => {
    if (!visible) return [];
    const collapsed = new Set(collapsedPaths);
    const active = Math.max(stackOrder.indexOf(activePath ?? ""), 0);
    const nearest: string[] = [];

    for (let distance = 0; nearest.length < stackOrder.length; distance += 1) {
      const below = stackOrder[active + distance];
      const above = distance === 0 ? undefined : stackOrder[active - distance];

      if (below !== undefined) nearest.push(below);

      if (above !== undefined) nearest.push(above);
    }

    return nearest.filter((path) => !collapsed.has(path));
  }, [visible, collapsedPaths, stackOrder, activePath]);

  // Patches are read for every expanded file, rendered headers first, under a
  // key that names the comparison and its state. A turn's patches are already
  // in hand; they take the same path so parsing stays off the main thread.
  const selectedTurnId = selectedTurn?.scope.turnId;
  const patchKey = vcsRead === undefined ? undefined : vcsReadKey(vcsRead);
  const { ignoreWhitespace } = options;
  const vcsLineage = `${root ?? ""}\u0000${activeScopeValue}\u0000${ignoreWhitespace ? "w" : ""}`;

  const patchSource = useMemo((): PatchSource | undefined => {
    if (selectedTurnId !== undefined) {
      const byPath = new Map(recordedRows.map((row) => [row.path, row]));

      return {
        key: `turn\u0000${selectedTurnId}\u0000${String(recordedVersion(recordedRows))}`,
        lineage: `turn\u0000${selectedTurnId}`,
        paths: stackOrder,
        read: async (paths) =>
          paths.flatMap((path) => {
            const row = byPath.get(path);

            return row === undefined || row.patch.trim() === ""
              ? []
              : [
                  {
                    path,
                    status: "modified" as const,
                    kind: "text" as const,
                    added: row.added,
                    removed: row.removed,
                    patch: row.patch,
                  },
                ];
          }),
      };
    }

    // The key names the revision; the request names only the comparison, which the
    // host reads at whatever state the repository is in when the read lands.
    const request = vcsRequestForScope(activeScope, { ignoreWhitespace });

    if (patchKey === undefined || request === undefined) return undefined;

    return {
      key: patchKey,
      lineage: vcsLineage,
      paths: stackOrder,
      read: (paths) => nyte.workspace.vcs.diff({ ...request, paths: [...paths] }),
    };
  }, [
    selectedTurnId,
    recordedRows,
    patchKey,
    vcsLineage,
    stackOrder,
    activeScope,
    ignoreWhitespace,
  ]);

  const [patches] = useState(createPatchLoader);

  const patchSnapshot = useSyncExternalStore(
    patches.subscribe,
    patches.getSnapshot,
    patches.getSnapshot,
  );

  useLayoutEffect(() => {
    if (patchSource !== undefined) patches.setSource(patchSource);
  }, [patches, patchSource]);

  useLayoutEffect(() => {
    patches.prepare(preparedPaths);
  }, [patches, preparedPaths]);

  // Leaving the panel drops every patch it read and any read still in flight.
  useMountEffect(() => () => patches.release());

  /** The entry a row shows, and whether it was read under the current key. */
  const patchFor = useCallback(
    (path: string): { readonly entry: PatchEntry; readonly fresh: boolean } | undefined => {
      const current = patchSource !== undefined && patchSnapshot.key === patchSource.key;
      const fresh = current ? patchSnapshot.fresh.get(path) : undefined;

      if (fresh !== undefined) return { entry: fresh, fresh: true };

      if (patchSource === undefined || patchSnapshot.lineage !== patchSource.lineage) {
        return undefined;
      }

      const stale =
        patchSnapshot.stale.get(path) ?? (current ? undefined : patchSnapshot.fresh.get(path));

      return stale === undefined ? undefined : { entry: stale, fresh: false };
    },
    [patchSnapshot, patchSource],
  );

  const sections = useMemo(
    () =>
      rows.map((row): ChangesStackItem => {
        const found = patchFor(row.path);
        const section = patchStackSection({ path: row.path, entry: found?.entry });

        const stat: VcsLineStat =
          row.source === "recorded"
            ? { kind: "text", added: row.added, removed: row.removed }
            : ((found?.fresh === true ? entryStat(found.entry) : undefined) ??
              statByPath.get(row.path) ??
              UNKNOWN_STAT);

        return { ...section, stat };
      }),
    [rows, patchFor, statByPath],
  );

  // A review mark records the patch that was read, so only an entry read under
  // the current key has a digest; anything else leaves a mark unchecked.
  const digestByPath = useMemo(() => {
    const digests = new Map<string, string>();

    for (const row of rows) {
      const found = patchFor(row.path);
      const digest = found?.fresh === true ? viewedDigest(found.entry) : undefined;

      if (digest !== undefined) digests.set(row.path, digest);
    }

    return digests;
  }, [rows, patchFor]);

  const vcsError = queryError(snapshot.error);
  const transcriptError = queryError(turnsError);

  // Each scope blames its own source first and falls back to the other, so no
  // failure is ever dropped. Turn options depend on the transcript; working-tree
  // rows depend on Git status.
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

  const manifestFailure = manifest.isError
    ? { text: "Couldn't read changes.", detail: queryError(manifest.error) }
    : undefined;

  const readFailure =
    scope.kind === "turn"
      ? (transcriptFailure ?? vcsFailure)
      : (manifestFailure ?? vcsFailure ?? transcriptFailure);

  // The turn's own files are loaded, so its emptiness is a fact that a stale
  // background failure cannot change.
  const emptyState: { readonly text: string; readonly detail?: string } =
    selectedTurn !== undefined
      ? { text: "This turn made no file changes" }
      : (readFailure ?? {
          text:
            snapshot.isLoading || manifest.isLoading
              ? "Loading changes…"
              : emptyScopeText(activeScope),
        });

  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;

  const viewedByPath = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const mark = viewedSnapshot[viewedScopeId]?.files[row.path];
          const digest = digestByPath.get(row.path);

          const state: ViewedState =
            mark === undefined
              ? "unviewed"
              : digest === undefined
                ? "unknown"
                : mark.digest === digest
                  ? "viewed"
                  : "changed";

          return [row.path, state];
        }),
      ),
    [rows, digestByPath, viewedSnapshot, viewedScopeId],
  );

  const viewedState = useCallback(
    (path: string): ViewedState => viewedByPath.get(path) ?? "unviewed",
    [viewedByPath],
  );

  const [markNotice, setMarkNotice] = useState({ scope: "", text: "" });

  // Marking reads every named patch first, in the loader's bounded batches, so
  // a mark always records a patch. A file whose patch cannot be read stays
  // unmarked and is reported, never certified; so is a request the changes
  // outran before every patch was read.
  const setViewed = useCallback(
    (paths: readonly string[], viewed: boolean): void => {
      if (!viewed) {
        changesViewed.clearAllViewed(viewedScopeId, paths);

        return;
      }

      const scopeValue = activeScopeValue;

      void patches.ensure(paths).then((answer) => {
        if (answer.kind === "superseded") {
          setMarkNotice({
            scope: scopeValue,
            text: "The changes moved before every file was read, so nothing was marked viewed.",
          });

          return;
        }

        const marks = paths.flatMap((path) => {
          const entry = answer.entries.get(path);
          const digest = entry === undefined ? undefined : viewedDigest(entry);

          return digest === undefined ? [] : [{ path, digest }];
        });

        changesViewed.markAllViewed(viewedScopeId, marks);
        const unread = paths.length - marks.length;

        setMarkNotice({
          scope: scopeValue,
          text:
            unread === 0
              ? ""
              : unread === 1
                ? "1 file wasn’t marked viewed because its diff couldn’t be read."
                : `${String(unread)} files weren’t marked viewed because their diffs couldn’t be read.`,
        });
      });
    },
    [viewedScopeId, patches, activeScopeValue],
  );

  const setFileViewed = useCallback(
    (path: string, viewed: boolean): void => {
      setViewed([path], viewed);
    },
    [setViewed],
  );

  // Only a working tree has both sides of a file to widen a gap with. A turn's
  // patch and a commit's are records of an edit, and the files have moved on.
  // Pierre re-renders every visible file when this changes, so it must not
  // follow the revision.
  const expandable = repository !== undefined && workingScope;

  const loadDiffFiles = useMemo(
    () =>
      expandable && root !== undefined
        ? createDiffFilesLoader({
            readContents: (input) =>
              nyte.workspace.vcs.contents({ ...input, target: { kind: "workspace" } }),
            root,
            scope: { kind: "worktree" },
          })
        : undefined,
    [expandable, root],
  );

  const sidebarFiles = useMemo(
    (): readonly ChangesSidebarFile[] =>
      sections.map((section) => {
        const row = rowByPath.get(section.path);
        const file = { path: section.path, stat: section.stat, viewed: viewedState(section.path) };

        return row === undefined || row.source === "recorded"
          ? file
          : { ...file, status: row.status };
      }),
    [sections, rowByPath, viewedState],
  );

  // A total over files whose counts are unknown would understate the change.
  const scopeStats = sections.reduce<{ added: number; removed: number } | undefined>(
    (total, section) =>
      total === undefined || section.stat.kind === "unknown"
        ? undefined
        : section.stat.kind === "binary"
          ? total
          : {
              added: total.added + section.stat.added,
              removed: total.removed + section.stat.removed,
            },
    { added: 0, removed: 0 },
  );

  const filterFiles = (): void => {
    // The rail mounts on toggle; focus lands the frame after it shows.
    if (!fileTreeVisible) onToggleFileTree();
    requestAnimationFrame(() => focusFileFilter(filterInput.current));
  };

  // Only a working tree has a state to go back to: a turn's patch and a
  // commit's are records, and the file has moved on since.
  const askToRevert = useCallback(
    (path: string): void => {
      const row = rowByPath.get(path);

      if (row === undefined || row.source !== "working") return;
      const opener = document.activeElement;
      revertReturnRef.current = opener instanceof HTMLButtonElement ? opener : null;
      setRevertError(undefined);
      setRevertTarget({ path, untracked: row.status === "untracked" });
    },
    [rowByPath],
  );

  const revertPath = workingScope ? (onRevertPath ?? askToRevert) : undefined;

  const confirmRevert = async (target: RevertTarget): Promise<void> => {
    setReverting(true);
    setRevertError(undefined);

    try {
      if (revision === undefined) {
        setRevertError("Refresh changes and try again.");

        return;
      }

      const result = await nyte.workspace.vcs.discard({
        target: { kind: "workspace" },
        paths: [target.path],
        expect: { revision },
      });

      if (result.kind === "stale") {
        refreshVcs();
        setRevertError("Changes changed. Review them and try again.");

        return;
      }

      if (result.kind !== "applied") {
        setRevertError(
          result.kind === "failed" ? result.reason : "A run is still writing to this workspace.",
        );

        return;
      }

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

  return (
    <section
      {...props(styles.panel)}
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
          {...props(styles.empty)}
        >
          {emptyState.text}
        </div>
      ) : (
        <div key={`${optionsScopeId}\u0000${activeScopeValue}`} {...props(styles.body)}>
          {fileTreeVisible && (
            <ChangesSidebar
              key={uiFontSize}
              files={sidebarFiles}
              activePath={activePath}
              filterInputRef={filterInput}
              onRevealPath={onRevealPath}
              onAllViewedChange={setViewed}
            />
          )}
          {visible && (
            <ChangesStack
              items={sections}
              collapsedPaths={collapsedPaths}
              onToggleCollapsed={toggleCollapsedPath}
              scrollTop={scrollTop}
              focusPath={activePath}
              focusRevision={
                appliedReveal.scope === activeScopeValue &&
                appliedReveal.revision === revealPathRevision
                  ? 0
                  : revealPathRevision
              }
              onFocusApplied={(revision) => setAppliedReveal({ scope: activeScopeValue, revision })}
              layout={options.layout}
              wordWrap={options.wordWrap}
              loadDiffFiles={loadDiffFiles}
              viewedState={viewedState}
              onViewedChange={setFileViewed}
              onRevertPath={revertPath}
              onScrollTop={onScrollTop}
              onActivePath={onSelectPath}
              onDemandPatch={patches.mount}
            />
          )}
        </div>
      )}
      {markNotice.scope === activeScopeValue && markNotice.text !== "" && (
        <div role="status" {...props(styles.unmarked)}>
          {markNotice.text}
        </div>
      )}
      <ConfirmDialog
        open={revertTarget !== undefined}
        pending={reverting}
        error={revertError}
        finalFocus={revertReturnRef}
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
  const run = snapshot.data?.run;

  return (
    <ChangesPanelView
      {...props}
      turns={snapshot.data?.transcript ?? EMPTY_TURNS}
      turnsError={snapshot.error}
      liveRun={run !== undefined && !isTerminalPhase(run.phase) ? run.runId : undefined}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  return props.sessionId === undefined ? (
    <ChangesPanelView {...props} turns={EMPTY_TURNS} turnsError={null} liveRun={undefined} />
  ) : (
    <SessionChangesPanel {...props} sessionId={props.sessionId} />
  );
}
