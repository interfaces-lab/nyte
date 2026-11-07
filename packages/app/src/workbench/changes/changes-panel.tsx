import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { ChangeSet, RunId, SessionId, SessionView, WorkspaceId } from "@nyte-ai/sdk";
import { FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { asId } from "@nyte-ai/schema";
import { createDiffFilesLoader } from "../../diff/diff-expansion.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  readGitPatches,
  readRecordedPatches,
  refreshVcs,
  useRecordedChanges,
  useVcsChanges,
  useVcsSnapshot,
  workspaceGit,
} from "../../data/vcs.ts";
import { useSessionRow } from "../../data/session-rows.ts";
import { conversationTurns } from "../../chat/transcript/turns.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { usePaneLayout } from "../../panes/pane-context.tsx";
import { activeSelection, sameSelection } from "../../panes/pane-layout.ts";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  branchReadout,
  changesRepository,
  changesScopeLabel,
  sameTurnOptions,
  sessionScopeOption,
  turnChangeOptions,
  turnScopeOption,
  vcsRequestForScope,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import type { TurnChangeOption } from "./change-scopes.ts";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import { preferences, useSetting } from "../../preferences/index.ts";
import { ChangesStack } from "./changes-stack.tsx";
import { createPatchLoader } from "../../diff/changes-patches.ts";
import type { PatchSource } from "../../diff/changes-patches.ts";
import type { ChangesStackHandle } from "./changes-stack.tsx";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import { setChangesViewOptions, useChangesViewOptions } from "./changes-view-options.ts";
import { changesViewed } from "../../diff/changes-viewed.ts";
import type { ViewedState } from "../../diff/changes-viewed.ts";
import type { WorkbenchChangesScope } from "../model.ts";
import { nyte } from "../../contract/nyte.ts";
import {
  changeRows,
  changeTotals,
  changesEmptyState,
  patchIdentity,
  preparationOrder,
  resolveChangesScope,
  revertConfirmation,
  sidebarFiles,
  stackSections,
  viewedDigest,
  viewedStates,
  workingRows,
} from "./changes-model.ts";
import type { ChangeRow, PatchSnapshot, RevertTarget, VcsChangeRow } from "./changes-model.ts";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";

const NO_TURN_OPTIONS: readonly TurnChangeOption[] = [];

const NO_COLLAPSED_PATHS: readonly string[] = [];

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  unmarked: {
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

function usePatchLoader(
  source: PatchSource | undefined,
  preparedPaths: readonly string[],
): ReturnType<typeof createPatchLoader> {
  const [patches] = useState(createPatchLoader);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- points the patch loader cache at the source before children read it
  useLayoutEffect(() => {
    if (source !== undefined) patches.setSource(source);
  }, [patches, source]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the patch loader cache which paths to prefetch
  useLayoutEffect(() => {
    patches.prepare(preparedPaths);
  }, [patches, preparedPaths]);

  useMountEffect(() => () => patches.release());

  return patches;
}

function useChangeRows(
  source: ChangeRow["source"],
  working: readonly VcsChangeRow[],
  manifest: ChangeSet | undefined,
  recorded: ChangeSet | undefined,
): readonly ChangeRow[] {
  "use memo";

  return changeRows(source, working, manifest, recorded);
}

function useStackSections(
  rows: readonly ChangeRow[],
  manifest: ChangeSet | undefined,
  snapshot: PatchSnapshot,
  source: PatchSource | undefined,
): readonly ChangesStackItem[] {
  "use memo";

  return stackSections(rows, manifest, snapshot, source);
}

async function revertFile(path: string, revision: string | undefined): Promise<string | undefined> {
  if (revision === undefined) return "Refresh changes and try again.";

  try {
    const result = await (
      await workspaceGit()
    ).discard([path], {
      expect: asId<"git-revision">(revision),
    });

    if (result.kind === "stale") {
      void refreshVcs();

      return "Changes changed. Review them and try again.";
    }

    if (result.kind === "rejected") return result.reason;

    if (result.kind === "busy") return "A run is still writing to this workspace.";

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn’t revert this file.";
  }
}

function focusFileFilter(field: HTMLInputElement | null): void {
  if (field === null) return;
  field.focus();
  field.select();
}

interface ChangesPanelProps {
  readonly visible?: boolean;
  readonly scope: WorkbenchChangesScope;
  readonly selectedPath: string | undefined;
  readonly revealPathRevision: number;
  readonly scrollTop: number;
  readonly fileTreeVisible: boolean;
  readonly onScopeChange: (scope: WorkbenchChangesScope) => void;
  readonly onToggleFileTree: () => void;
  readonly onScrollTop: (scrollTop: number, selectedPath: string | undefined) => void;
  readonly onOpenLink?: (url: string) => void;
}

interface ChangesPanelViewProps extends ChangesPanelProps {
  readonly sessionId: SessionId | undefined;
  readonly turnOptions: readonly TurnChangeOption[];
  readonly liveRun: RunId | undefined;
  readonly workspace: WorkspaceId | undefined;
  readonly sessionChanges: SessionView["changes"] | undefined;
}

function ChangesPanelView({
  visible = true,
  scope,
  selectedPath,
  revealPathRevision,
  scrollTop,
  fileTreeVisible,
  onScopeChange,
  onToggleFileTree,
  onScrollTop,
  onOpenLink,
  sessionId,
  turnOptions,
  liveRun,
  workspace,
  sessionChanges,
}: ChangesPanelViewProps): ReactElement {
  const uiFontSize = useSetting(preferences.uiFontSize);

  const sessionOption =
    sessionChanges === undefined ? undefined : sessionScopeOption(sessionChanges);

  const snapshot = useVcsSnapshot(visible);
  const filterInput = useRef<HTMLInputElement>(null);
  const stack = useRef<ChangesStackHandle>(null);
  const revertReturnRef = useRef<HTMLButtonElement | null>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | undefined>(undefined);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | undefined>(undefined);
  const [appliedReveal, setAppliedReveal] = useState({ scope: "", revision: 0 });

  const [collapsedSections, setCollapsedSections] = useState<{
    readonly scope: string;
    readonly paths: readonly string[];
  }>({ scope: "", paths: NO_COLLAPSED_PATHS });

  const [markNotice, setMarkNotice] = useState({ scope: "", text: "" });

  const [scrolled, setScrolled] = useState<{
    readonly scope: string;
    readonly revision: number;
    readonly path: string | undefined;
  }>({ scope: "", revision: 0, path: undefined });

  const resolved = resolveChangesScope(scope, turnOptions, sessionId);
  const activeScope = resolved.scope;
  const activeScopeValue = resolved.value;
  const recordedSource = resolved.recorded;
  const repository = changesRepository(snapshot.data);
  const root = repository?.root;
  const revision = repository?.revision;

  const viewedSnapshot = useSyncExternalStore(
    changesViewed.subscribe,
    changesViewed.getSnapshot,
    changesViewed.getSnapshot,
  );

  const optionsScopeId = root ?? "workspace";
  const options = useChangesViewOptions(optionsScopeId);
  const ignoreWhitespace = options.ignoreWhitespace;
  const working = workingRows(snapshot.data, activeScope);
  const vcsRequest = vcsRequestForScope(activeScope);

  const manifest = useVcsChanges(
    repository === undefined ? undefined : vcsRequest,
    ignoreWhitespace,
    revision,
    visible && (resolved.rows !== "working" || working.length > 0),
  );

  const recorded = useRecordedChanges({
    workspace,
    source: recordedSource,
    live:
      liveRun !== undefined &&
      (recordedSource?.kind === "session" ||
        (recordedSource?.kind === "run" && recordedSource.run === liveRun)),
    enabled: visible,
  });

  const rows = useChangeRows(resolved.rows, working, manifest.data, recorded.data);
  const stackOrder = rows.map((row) => row.path);

  const collapsedPaths =
    collapsedSections.scope === activeScopeValue ? collapsedSections.paths : NO_COLLAPSED_PATHS;

  const allCollapsed = rows.length > 0 && rows.every((row) => collapsedPaths.includes(row.path));

  const shownPath =
    scrolled.scope === activeScopeValue && scrolled.revision === revealPathRevision
      ? scrolled.path
      : selectedPath;

  const activePath = rows.some((row) => row.path === shownPath) ? shownPath : rows[0]?.path;
  const preparedPaths = visible ? preparationOrder(rows, activePath, collapsedPaths) : [];

  const readPatches: PatchSource["read"] | undefined =
    resolved.rows === "recorded"
      ? workspace === undefined || recordedSource === undefined
        ? undefined
        : (paths) => readRecordedPatches(workspace, recordedSource, paths, ignoreWhitespace)
      : vcsRequest === undefined
        ? undefined
        : (paths) => readGitPatches(vcsRequest, paths, ignoreWhitespace);

  const identity = patchIdentity({ resolved, repository, ignoreWhitespace, rows });

  const patchSource: PatchSource | undefined =
    identity === undefined || readPatches === undefined
      ? undefined
      : { ...identity, paths: stackOrder, read: readPatches };

  const patches = usePatchLoader(patchSource, preparedPaths);
  const refresh = useMutation({ mutationFn: refreshVcs });

  const patchSnapshot = useSyncExternalStore(
    patches.subscribe,
    patches.getSnapshot,
    patches.getSnapshot,
  );

  const sections = useStackSections(rows, manifest.data, patchSnapshot, patchSource);
  const totals = changeTotals(rows, manifest.data);
  const emptyState = changesEmptyState({ resolved, snapshot: snapshot.data, manifest, recorded });
  const viewedScopeId = `${optionsScopeId}\u0000${activeScopeValue}`;

  const viewed = viewedStates(
    rows,
    viewedSnapshot[viewedScopeId]?.files,
    patchSnapshot,
    patchSource,
  );

  const viewedState = (path: string): ViewedState => viewed.get(path) ?? "unviewed";
  const rowByPath = new Map(rows.map((row) => [row.path, row]));

  const setViewed = (paths: readonly string[], viewed: boolean): void => {
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
  };

  const setFileViewed = (path: string, viewed: boolean): void => {
    setViewed([path], viewed);
  };

  const workingScope = resolved.rows === "working";
  const expandable = repository !== undefined && workingScope;

  const loadDiffFiles =
    expandable && root !== undefined
      ? createDiffFilesLoader({
          readContents: async (input) => (await workspaceGit()).contents(input.path, input.scope),
          root,
          scope: { kind: "worktree" },
        })
      : undefined;

  const filterFiles = (): void => {
    if (!fileTreeVisible) onToggleFileTree();
    requestAnimationFrame(() => focusFileFilter(filterInput.current));
  };

  const askToRevert = (path: string): void => {
    const row = rowByPath.get(path);

    if (row === undefined || row.source !== "working") return;
    const opener = document.activeElement;
    revertReturnRef.current = opener instanceof HTMLButtonElement ? opener : null;
    setRevertError(undefined);
    setRevertTarget({ path, untracked: row.status === "untracked" });
  };

  const revertPath = workingScope ? askToRevert : undefined;

  const confirmRevert = async (target: RevertTarget): Promise<void> => {
    setReverting(true);
    setRevertError(undefined);
    const failure = await revertFile(target.path, revision);
    setReverting(false);

    if (failure !== undefined) {
      setRevertError(failure);

      return;
    }

    changesViewed.clearViewed(viewedScopeId, target.path);
    void refreshVcs();
    setRevertTarget(undefined);
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
      data-slot="changes-panel"
      aria-label="Workspace changes"
      onKeyDown={(event) => {
        const action = changesShortcutAction(event.nativeEvent, nyte.platform === "darwin");

        if (action === undefined) return;
        event.preventDefault();

        if (action === "filter-files") {
          filterFiles();

          return;
        }

        if (action === "refresh") {
          refresh.mutate();

          return;
        }

        setChangesViewOptions(optionsScopeId, {
          ignoreWhitespace: !options.ignoreWhitespace,
        });
      }}
    >
      <FileTypeIconSprite />
      <ChangesToolbar
        scope={activeScope}
        scopeLabel={changesScopeLabel(activeScope, [
          ...workingTreeScopeOptions(snapshot.data),
          ...(sessionOption === undefined ? [] : [sessionOption]),
          ...turnOptions.map(turnScopeOption),
        ])}
        scopeStats={totals.stats}
        scopeFileCount={totals.fileCount}
        snapshot={snapshot.data}
        repository={repository}
        branch={branchReadout(snapshot.data)}
        sessionOption={sessionOption}
        turnOptions={turnOptions}
        workspace={workspace}
        liveRun={liveRun}
        viewOptions={options}
        fileTreeVisible={fileTreeVisible}
        onScopeChange={onScopeChange}
        onViewOptionsChange={(changes) => {
          setChangesViewOptions(optionsScopeId, changes);
        }}
        onToggleFileTree={onToggleFileTree}
        onRefresh={() => refresh.mutate()}
        refreshing={refresh.isPending}
        onFilterFiles={filterFiles}
        allFilesCollapsed={allCollapsed}
        onToggleCollapseAll={toggleCollapseAll}
        onOpenLink={onOpenLink}
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
              files={sidebarFiles(sections, rows, viewed)}
              activePath={activePath}
              filterInputRef={filterInput}
              onRevealPath={(path) => stack.current?.reveal(path)}
              onAllViewedChange={setViewed}
            />
          )}
          <ChangesStack
            ref={stack}
            items={sections}
            collapsedPaths={collapsedPaths}
            onToggleCollapsed={toggleCollapsedPath}
            onExpand={(path) =>
              setCollapsedSections((current) => ({
                ...current,
                paths: current.paths.filter((entry) => entry !== path),
              }))
            }
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
            onActivePath={(path) =>
              setScrolled({ scope: activeScopeValue, revision: revealPathRevision, path })
            }
            onDemandPatch={patches.mount}
          />
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
  const store = chatStore(props.sessionId);

  const turnOptions = useWatchSelect(
    store,
    ({ value }) =>
      value === undefined ? NO_TURN_OPTIONS : turnChangeOptions(conversationTurns(value)),
    sameTurnOptions,
  );

  const liveRun = useWatchSelect(store, ({ value }) =>
    value === undefined || value.execution.kind === "idle" ? undefined : value.execution.run.id,
  );

  const sessionChanges = useWatchSelect(store, ({ value }) => value?.changes);
  const workspace = useSessionRow(props.sessionId, (session) => session.workspace);

  return (
    <ChangesPanelView
      {...props}
      turnOptions={turnOptions}
      liveRun={liveRun}
      workspace={workspace ?? undefined}
      sessionChanges={sessionChanges}
    />
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  const selection = usePaneLayout(activeSelection, sameSelection);

  return selection.kind !== "session" ? (
    <ChangesPanelView
      {...props}
      sessionId={undefined}
      turnOptions={NO_TURN_OPTIONS}
      liveRun={undefined}
      workspace={undefined}
      sessionChanges={undefined}
    />
  ) : (
    <SessionChangesPanel {...props} sessionId={selection.sessionId} />
  );
}
