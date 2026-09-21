// TanStack Query over the SDK operations. Startup seeds local data before mounting
// the shell. Watches invalidate settled data; what has no watch operation yet
// (the session directory, jobs, children, VCS status) polls on a slow interval.
import {
  QueryClient,
  queryOptions,
  useMutation,
  useMutationState,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { projectPreference } from "./preference-projection.ts";
import { useMemo, useSyncExternalStore } from "react";
import { keys } from "./query-keys.ts";
import { SessionActions } from "./session-actions.ts";
import {
  projectSessionConfiguration,
  sessionConfigurationOptions,
} from "./session-configuration.ts";
import type { ConfigureSessionPatch, PendingConfiguration } from "./session-configuration.ts";
export { keys } from "./query-keys.ts";
import { toast } from "@nyte-ai/ui/sonner";
import { sessionId } from "@nyte-ai/protocol";
import { isTerminalPhase } from "@nyte-ai/client";
import type { MentionFile } from "@nyte-ai/client";
import type {
  PluginCatalog,
  RunDiff,
  RunId,
  SessionId,
  SessionInfo,
  SessionSnapshot,
  SettingInfo,
  VcsDiff,
  VcsLog,
  VcsRefs,
  VcsSnapshot,
  WorkspaceInfo,
} from "@nyte-ai/protocol";
import { localSessions } from "../../shared/ipc.ts";
import type {
  DesktopCatalog,
  HostState,
  MobileShareState,
  PreferenceChange,
  ServerState,
  UsageSnapshot,
  UsageWindow,
  WorkspaceFileDocument,
  WorkspaceSessionDirectory,
} from "../../shared/ipc.ts";
import { loadSessionDirectory, type SessionPage } from "./session-directory.ts";
// The query layer reads sessions through the observer and the observer writes
// this cache; neither module touches the other while it evaluates.
import { readSessionSnapshot, sessionSelection } from "./live.ts";
import { nyte } from "./nyte.ts";
import { RunDiffFreshness } from "./run-diff-freshness.ts";
import { SessionObservations } from "./session-freshness.ts";
import { installSnapshotCacheBudget, releaseSessionQueries } from "./snapshot-cache.ts";
import { USAGE_STALE_AFTER_MS } from "./chrome/usage-view.ts";
import type { WorkspaceSearchInput } from "../../shared/workspace-editor.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: Infinity,
      retry: false,
    },
  },
});

installSnapshotCacheBudget(queryClient);

const sessionActionsByClient = new WeakMap<QueryClient, SessionActions>();

function actionsFor(client: QueryClient): SessionActions {
  const existing = sessionActionsByClient.get(client);
  if (existing !== undefined) return existing;
  const actions = new SessionActions({
    client,
    sessions: nyte.sessions,
    releaseResources: (sessionId) => releaseSessionRendererMemory(client, sessionId),
  });
  sessionActionsByClient.set(client, actions);
  return actions;
}

export function useSessionActions(): SessionActions {
  return actionsFor(useQueryClient());
}

function useSessionProjection() {
  const actions = useSessionActions();
  const pending = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot);
  return {
    session: (session: SessionInfo) => actions.projectSession(session, pending),
    list: (sessions: readonly SessionInfo[]) => actions.projectList(sessions, pending),
  };
}

export const SNAPSHOT_WARM_MS = 1_000;

const readHost = () => nyte.host.state();
const readWorkspaces = () => nyte.workspace.list();
const sessionObservations = new SessionObservations();
const runDiffFreshness = new RunDiffFreshness();

function releaseSessionRendererMemory(client: QueryClient, sessionId: SessionId): void {
  sessionObservations.release(sessionId);
  runDiffFreshness.release(sessionId);
  releaseSessionQueries(client, sessionId);
}

function freshestSessionInfo(polled: SessionInfo, pollStartedAt: number): SessionInfo {
  return sessionObservations.freshest(
    polled,
    pollStartedAt,
    queryClient.getQueryData<SessionInfo | null>(keys.session(polled.sessionId)),
  );
}

const readSessionPreview = async (): Promise<SessionPage> => {
  const startedAt = performance.now();
  const page = await loadSessionDirectory((input) => nyte.sessions.list(input));
  return { ...page, items: page.items.map((item) => freshestSessionInfo(item, startedAt)) };
};
const readSessionDirectory = async (): Promise<readonly WorkspaceSessionDirectory[]> => {
  const startedAt = performance.now();
  const directories = await nyte.host.sessionDirectory();
  return directories.map((directory) => ({
    ...directory,
    sessions: directory.sessions.map((item) => freshestSessionInfo(item, startedAt)),
  }));
};
const readCatalog = () => nyte.host.catalog();
const readUsage = (input: UsageWindow) => nyte.host.usage(input);
const readPluginCatalog = (): Promise<PluginCatalog> => nyte.plugins.catalog();
const readSession = async (sessionId: SessionId) =>
  (await nyte.sessions.get({ sessionId })) ?? null;

export function useHostState() {
  return useQuery({ queryKey: keys.host, queryFn: readHost });
}

export function useServerState(active: boolean) {
  return useQuery({
    queryKey: keys.server,
    queryFn: (): Promise<ServerState> => nyte.host.server.state(),
    staleTime: active ? 0 : Infinity,
    refetchInterval: active ? 15_000 : false,
    refetchOnWindowFocus: active ? "always" : false,
    refetchOnMount: active ? "always" : false,
  });
}

export function useMobileShareState(active: boolean) {
  return useQuery({
    queryKey: keys.mobileShare,
    queryFn: (): Promise<MobileShareState> => nyte.host.mobile.state(),
    enabled: active,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
}

export function useWorkspaces() {
  const pending = useMutationState<MutationState<void, Error, string>>({
    filters: { mutationKey: ["workspace", "forget"], status: "pending" },
  });
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: readWorkspaces,
    select: (workspaces) =>
      workspaces.filter(
        (workspace) => !pending.some((mutation) => mutation.variables === workspace.path),
      ),
  });
}

/** Drop a workspace from the rail. Forgetting the selected workspace returns the view to Home. */
export function useForgetWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["workspace", "forget"],
    mutationFn: (path: string) => nyte.workspace.forget({ path }),
    onSuccess: async (_result, path) => {
      await client.cancelQueries({ queryKey: keys.workspaces, exact: true });
      client.setQueryData<Awaited<ReturnType<typeof readWorkspaces>>>(
        keys.workspaces,
        (workspaces) => workspaces?.filter((workspace) => workspace.path !== path),
      );
      toast.success("Workspace removed from sidebar", { id: "workspace-forgotten" });
    },
    onError: () =>
      toast.error("Couldn't remove this workspace. Try again.", { id: "workspace-forget-error" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useWorkspaceSessionDirectory() {
  const projection = useSessionProjection();
  return useQuery({
    queryKey: keys.sessionDirectory,
    queryFn: readSessionDirectory,
    select: (directories) =>
      directories.map((directory) => ({
        ...directory,
        sessions: projection.list(directory.sessions),
      })),
    refetchInterval: 5_000,
  });
}

export function useSessionPreview(enabled = true) {
  const projection = useSessionProjection();
  return useQuery({
    queryKey: keys.sessionPreview,
    queryFn: readSessionPreview,
    select: (page) => ({ ...page, items: projection.list(page.items) }),
    enabled,
    // No directory watch operation yet; a slow tick keeps liveness honest.
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useSessionSearch(search: string, enabled = true) {
  const projection = useSessionProjection();
  const normalized = search.trim();
  return useQuery({
    queryKey: keys.sessionSearch(normalized),
    queryFn: () => nyte.sessions.list({ search: normalized, parent: null, limit: 50 }),
    select: (page) => ({
      ...page,
      items: projection.list(page.items).filter((session) => !session.archived),
    }),
    enabled: enabled && normalized !== "",
  });
}

export function useSession(sessionId: SessionId) {
  const projection = useSessionProjection();
  return useQuery({
    queryKey: keys.session(sessionId),
    queryFn: () => readSession(sessionId),
    select: (session) => (session === null ? null : projection.session(session)),
  });
}

export function useSessionSnapshot(sessionId: SessionId) {
  const projection = useSessionProjection();
  const pending = useMutationState<PendingConfiguration>({
    filters: { mutationKey: ["session", sessionId, "configure"], status: "pending" },
  });
  // Every mount reads through the observer: its state when the session is
  // already open, else the fresh coherent read its watch starts from, so a
  // reopened view never trusts a cache that predates a hidden interval. Cached
  // content paints meanwhile; the read never gates navigation.
  return useQuery({
    queryKey: keys.snapshot(sessionId),
    queryFn: ({ signal }) => readSessionSnapshot(sessionId, signal),
    select: (snapshot) => ({
      ...snapshot,
      session: projectSessionConfiguration(
        projection.session(snapshot.session) ?? snapshot.session,
        pending,
      ),
    }),
    refetchOnMount: "always",
    // Reopening a chat costs a full session read, and the five-minute default
    // drops a transcript between two visits in the same sitting. Only a chat
    // that was opened keeps this: a hover warm writes the same key through
    // `prefetchQuery`, which keeps the default, so a transcript the reader
    // only passed over still expires while the ones they move between stay.
    gcTime: 60 * 60 * 1_000,
  });
}

/** The child sessions one chat delegated to. Parent commits invalidate this; an observed child updates its own row. */
export function useChildSessions(sessionId: SessionId | undefined) {
  return useQuery({
    queryKey: keys.childSessions(sessionId),
    queryFn: async (): Promise<readonly SessionInfo[]> => {
      if (sessionId === undefined) return [];
      const startedAt = performance.now();
      const first = await nyte.sessions.list({ parent: sessionId });
      const children = [...first.items];
      let cursor = first.next;
      while (cursor !== undefined) {
        const page = await nyte.sessions.list({ parent: sessionId, cursor });
        children.push(...page.items);
        cursor = page.next;
      }
      return children.map((child) => freshestSessionInfo(child, startedAt));
    },
    enabled: sessionId !== undefined,
  });
}

const WORKSPACE_TARGET = { kind: "workspace" } as const;
const readVcsSnapshot = () => nyte.workspace.vcs.snapshot({ target: WORKSPACE_TARGET });

export function refreshVcsSnapshot(): Promise<VcsSnapshot> {
  return queryClient.fetchQuery({
    queryKey: keys.vcsSnapshot,
    queryFn: readVcsSnapshot,
    staleTime: 0,
  });
}

export function useVcsSnapshot(enabled: boolean) {
  return useQuery<VcsSnapshot>({
    queryKey: keys.vcsSnapshot,
    queryFn: readVcsSnapshot,
    enabled,
    staleTime: 5_000,
    refetchOnMount: true,
    refetchInterval: enabled ? 5_000 : false,
  });
}

/**
 * Scope-aware VCS keys. They nest under the `["vcs"]` prefix `refreshVcs`
 * invalidates, so a run or a save refreshes history and refs with the status.
 */
export const vcsKeys = {
  diff: (
    root: string,
    revision: string,
    scopeKey: string,
    pathsKey: string,
    ignoreWhitespace: boolean,
  ) => ["vcs", "diffs", root, revision, scopeKey, pathsKey, ignoreWhitespace] as const,
  log: (limit: number, before: string | null) => ["vcs", "log", limit, before] as const,
  refs: ["vcs", "refs"] as const,
  runDiff: (sessionId: SessionId, runId: RunId) => ["vcs", "run-diff", sessionId, runId] as const,
};

function createRunDiffReader(sessionId: SessionId): (runId: RunId) => Promise<RunDiff> {
  let waiting = new Map<RunId, PromiseWithResolvers<RunDiff>>();
  let scheduled = false;

  const flush = async (): Promise<void> => {
    const readers = waiting;
    waiting = new Map();
    scheduled = false;
    const first = readers.keys().next().value;
    if (first === undefined) return;
    const runs = [first, ...[...readers.keys()].slice(1)] satisfies readonly [RunId, ...RunId[]];
    try {
      const results = await nyte.runs.diff({ sessionId, runs });
      for (const [runId, reader] of readers) {
        const result = results.find((candidate) => candidate.run === runId);
        reader.resolve(result?.diff ?? { kind: "not_found" });
      }
    } catch (cause) {
      for (const reader of readers.values()) reader.reject(cause);
    }
  };

  return (runId) => {
    const pending = waiting.get(runId);
    if (pending !== undefined) return pending.promise;
    const reader = Promise.withResolvers<RunDiff>();
    waiting.set(runId, reader);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => void flush());
    }
    return reader.promise;
  };
}

function terminalForRunDiff(sessionId: SessionId, runId: RunId): boolean {
  const current = queryClient.getQueryData<SessionSnapshot>(keys.snapshot(sessionId))?.run;
  return current === undefined || current.runId !== runId || isTerminalPhase(current.phase);
}

async function checkedRunDiff(
  sessionId: SessionId,
  runId: RunId,
  read: () => Promise<RunDiff>,
): Promise<RunDiff> {
  const terminal = terminalForRunDiff(sessionId, runId);
  const diff = await read();
  runDiffFreshness.recordCheck(sessionId, runId, terminal);
  return diff;
}

/** Read several exact run diffs in one operation while caching each run under its own key. */
export function useRunDiffs(
  sessionId: SessionId,
  runIds: readonly RunId[],
): ReadonlyMap<RunId, RunDiff | undefined> {
  const unique = [...new Set(runIds)];
  const current = queryClient.getQueryData<SessionSnapshot>(keys.snapshot(sessionId))?.run;
  const liveRun =
    current !== undefined && !isTerminalPhase(current.phase) ? current.runId : undefined;
  const read = useMemo(() => createRunDiffReader(sessionId), [sessionId]);
  const results = useQueries({
    queries: unique.map((runId) => {
      const terminal = runId !== liveRun;
      const cached = queryClient.getQueryData<RunDiff>(vcsKeys.runDiff(sessionId, runId));
      const needsRefresh = runDiffFreshness.needsRefresh(sessionId, runId, terminal, cached);
      return {
        queryKey: vcsKeys.runDiff(sessionId, runId),
        queryFn: () => checkedRunDiff(sessionId, runId, () => read(runId)),
        staleTime: needsRefresh ? 0 : Infinity,
        refetchOnMount: needsRefresh,
      };
    }),
  });
  const diffs = new Map<RunId, RunDiff | undefined>();
  for (const [index, runId] of unique.entries()) diffs.set(runId, results[index]?.data);
  return diffs;
}

/** One run's file diff, exact from its recorded trees when the host has them; refreshed with the VCS state. */
export function useRunDiff(
  sessionId: SessionId | undefined,
  runId: RunId | undefined,
  enabled = true,
) {
  const terminal =
    sessionId === undefined || runId === undefined ? true : terminalForRunDiff(sessionId, runId);
  const cached =
    sessionId === undefined || runId === undefined
      ? undefined
      : queryClient.getQueryData<RunDiff>(vcsKeys.runDiff(sessionId, runId));
  const needsRefresh =
    sessionId !== undefined &&
    runId !== undefined &&
    runDiffFreshness.needsRefresh(sessionId, runId, terminal, cached);
  return useQuery<RunDiff>({
    queryKey:
      sessionId === undefined || runId === undefined
        ? (["vcs", "run-diff", "unavailable"] as const)
        : vcsKeys.runDiff(sessionId, runId),
    queryFn: async () => {
      if (sessionId === undefined || runId === undefined) return { kind: "not_found" };
      return checkedRunDiff(sessionId, runId, async () => {
        const [result] = await nyte.runs.diff({ sessionId, runs: [runId] });
        return result?.diff ?? { kind: "not_found" };
      });
    },
    enabled: enabled && sessionId !== undefined && runId !== undefined,
    staleTime: needsRefresh ? 0 : Infinity,
    refetchOnMount: needsRefresh,
  });
}

export type VcsDiffRequest = Parameters<typeof nyte.workspace.vcs.diff>[0];

export interface VcsDiffRead {
  readonly root: string;
  readonly revision: string;
  readonly request: VcsDiffRequest;
}

function scopeKey(scope: VcsDiffRequest["scope"]): string {
  switch (scope.kind) {
    case "worktree":
    case "staged":
    case "unstaged":
      return scope.kind;
    case "commit":
      return `commit:${scope.oid}`;
    case "branch":
      return `branch:${scope.base}`;
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

export function useVcsDiff(read: VcsDiffRead | undefined, enabled: boolean) {
  const request = read?.request;
  const diffScopeKey = request === undefined ? undefined : scopeKey(request.scope);
  const pathsKey = request?.paths === undefined ? "" : [...request.paths].toSorted().join("\0");
  return useQuery<readonly VcsDiff[]>({
    queryKey:
      read === undefined
        ? vcsKeys.diff("unavailable", "unavailable", "", "", false)
        : vcsKeys.diff(
            read.root,
            read.request.scope.kind === "commit" ? read.request.scope.oid : read.revision,
            diffScopeKey ?? "",
            pathsKey,
            read.request.ignoreWhitespace === true,
          ),
    queryFn: () => (request === undefined ? [] : nyte.workspace.vcs.diff(request)),
    enabled: enabled && request !== undefined,
    gcTime: request?.scope.kind === "commit" ? undefined : 0,
  });
}

/** A page of history, newest first. `before` continues strictly older than that commit. */
export function useVcsLog(
  input: { readonly limit: number; readonly before?: string },
  enabled: boolean,
) {
  return useQuery<VcsLog>({
    queryKey: vcsKeys.log(input.limit, input.before ?? null),
    queryFn: () => nyte.workspace.vcs.log({ ...input, target: WORKSPACE_TARGET }),
    enabled,
  });
}

/** Local and remote short ref names. */
export function useVcsRefs(enabled: boolean) {
  return useQuery<VcsRefs>({
    queryKey: vcsKeys.refs,
    queryFn: () => nyte.workspace.vcs.refs({ target: WORKSPACE_TARGET }),
    enabled,
  });
}

function vcsNeedsRefresh({ queryKey }: { readonly queryKey: readonly unknown[] }): boolean {
  if (queryKey[1] === "run-diff") {
    const sessionKey = queryKey[2];
    const runId = queryKey[3];
    if (typeof sessionKey !== "string" || typeof runId !== "string") return false;
    const run = queryClient.getQueryData<SessionSnapshot>(
      keys.snapshot(sessionId(sessionKey)),
    )?.run;
    const terminal = run === undefined || run.runId !== runId || isTerminalPhase(run.phase);
    return runDiffFreshness.needsRefresh(
      sessionId(sessionKey),
      runId,
      terminal,
      queryClient.getQueryData<RunDiff>(queryKey),
    );
  }
  const scope = queryKey[4];
  return queryKey[1] !== "diffs" || (typeof scope === "string" && scope.startsWith("branch:"));
}

export function refreshVcs(): void {
  void queryClient.invalidateQueries({
    queryKey: ["vcs"],
    predicate: vcsNeedsRefresh,
  });
  void queryClient.invalidateQueries({ queryKey: keys.mentionFiles, exact: true });
}

/**
 * The open workspace's files for `@` mentions. Runs rewrite the tree, so the
 * list is invalidated with the VCS state and refetched when a composer mounts.
 */
export function mentionFilesOptions(enabled: boolean) {
  return queryOptions({
    queryKey: keys.mentionFiles,
    queryFn: async ({ signal }): Promise<readonly MentionFile[]> => {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const pending = nyte.host.files.list({ requestId });
      const cancel = () => {
        void nyte.host.files.cancelList({ requestId }).catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await pending;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export function useMentionFiles(enabled: boolean) {
  return useQuery(mentionFilesOptions(enabled));
}

export function useWorkspaceFile(path: string | undefined) {
  return useQuery<WorkspaceFileDocument>({
    queryKey: keys.workspaceFile(path ?? ""),
    queryFn: () => {
      if (path === undefined) throw new Error("Select a file to open it");
      return nyte.host.files.read({ path });
    },
    enabled: path !== undefined,
    staleTime: 1_000,
  });
}

export function useWorkspaceSearch(
  input: Omit<WorkspaceSearchInput, "requestId"> | undefined,
  enabled = true,
) {
  const host = useHostState();
  const workspacePath = host.data?.workspace?.path;
  return useQuery({
    queryKey: keys.workspaceSearch(workspacePath ?? "", input),
    queryFn: async ({ signal }) => {
      if (input === undefined || workspacePath === undefined)
        throw new Error("Open a workspace to search");
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const pending = nyte.host.files.search({ ...input, requestId });
      const cancel = () => {
        void nyte.host.files.cancelSearch({ requestId }).catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        return await pending;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    enabled:
      enabled && workspacePath !== undefined && input !== undefined && input.query.length > 0,
    staleTime: 0,
    refetchOnMount: true,
    gcTime: 0,
  });
}

export function useSaveWorkspaceFile() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["files", "save"],
    mutationFn: (input: Parameters<typeof nyte.host.files.save>[0]) => nyte.host.files.save(input),
    onSuccess: (outcome, input) => {
      if (outcome.kind !== "saved") return;
      client.setQueryData<WorkspaceFileDocument>(
        keys.workspaceFile(input.path),
        (): WorkspaceFileDocument => ({
          kind: "text",
          path: input.path,
          contents: input.contents,
          version: outcome.version,
        }),
      );
      void client.invalidateQueries({
        queryKey: ["vcs"],
        predicate: vcsNeedsRefresh,
      });
      void client.invalidateQueries({ queryKey: keys.mentionFiles, exact: true });
      void client.invalidateQueries({ queryKey: ["files", "search"] });
      void client.invalidateQueries({ queryKey: ["files", "blame"] });
    },
  });
}

/** Providers, models, and the defaults a new chat starts with, in one read. */
export function useCatalog(sessionId?: SessionId) {
  const pending = useMutationState<MutationState<DesktopCatalog, Error, PreferenceChange>>({
    filters: { mutationKey: ["catalog", "preference"], status: "pending" },
  });
  return useQuery({
    queryKey: sessionId === undefined ? keys.catalog : keys.sessionCatalog(sessionId),
    queryFn: () => (sessionId === undefined ? readCatalog() : nyte.host.catalog({ sessionId })),
    staleTime: sessionId === undefined ? Infinity : 15_000,
    refetchOnMount: sessionId !== undefined,
    select: (catalog) =>
      catalog.source === "server"
        ? catalog
        : pending.reduce(
            (current, mutation) =>
              mutation.variables === undefined
                ? current
                : projectPreference(current, mutation.variables),
            catalog,
          ),
  });
}

/**
 * Registered desktop history has no usage watch. Refresh on each visit or
 * manually, not on a timer: the host walks stored commits for every read.
 *
 * The read is unbounded and the range is a view of it. The host walks every
 * stored commit whatever window it is handed, so asking for one window bought
 * nothing and made every range press a fresh multi-second read. One read
 * answers all four ranges, and switching between them touches no I/O.
 */
export function usageReportOptions(untilDay: string) {
  return queryOptions({
    queryKey: keys.usage(untilDay),
    queryFn: () => readUsage({ sinceDay: null, untilDay }),
    // The client never refetches on its own, so Usage opts back in on mount.
    // What it does not do is re-read unconditionally: reopening the panel cost
    // seconds for numbers that had not moved. The mount read waits for the same
    // age at which the page starts offering to re-read, so "current" means one
    // thing on this page.
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
  });
}

/**
 * A usage read, flattened to what the page actually branches on.
 *
 * A failed refresh keeps the last good report and reports the error alongside
 * it: totals that were true a minute ago beat an empty screen, and the page
 * says which they are.
 */
interface UsageQueryView {
  readonly report: UsageSnapshot | undefined;
  readonly error: Error | null;
  /** No report yet. Distinct from refreshing one that is already on screen. */
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly refresh: () => void;
}

export function useUsageReport(untilDay: string): UsageQueryView {
  const query = useQuery(usageReportOptions(untilDay));
  return {
    report: query.data,
    error: query.isError
      ? (query.error ?? new Error("The host could not read local history."))
      : null,
    isPending: query.data === undefined && !query.isError,
    isFetching: query.isFetching,
    refresh: () => void query.refetch({ cancelRefetch: false }),
  };
}

/**
 * Provider-reported subscription windows: the one usage read that leaves the
 * machine. It shares the page's definition of current, so a visit inside that
 * window paints the cached windows and asks nobody.
 */
export function useAccountLimits() {
  return useQuery({
    queryKey: keys.accountLimits,
    queryFn: () => nyte.host.accountLimits(),
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
  });
}

/** Commands and skills available before a chat exists. */
export function usePluginCatalog() {
  return useQuery({ queryKey: keys.pluginCatalog, queryFn: readPluginCatalog });
}

/** Controls show pending choices while the host returns the authoritative catalog. */
export function useSetPreference() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["catalog", "preference"],
    scope: { id: "catalog-preference" },
    mutationFn: (change: PreferenceChange) => nyte.host.setPreference(change),
    onSuccess: async (catalog) => {
      await client.cancelQueries({ queryKey: keys.catalog, exact: true });
      client.setQueryData(keys.catalog, catalog);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.catalog, exact: true }),
    onError: () => toast.error("Couldn't save model preferences. Try again."),
  });
}

let localLoadVersion = 0;

/**
 * The host has changed folders: the stage rebinds to that folder's panes now,
 * before the caches behind it refill. `outcome.workspace` is the host's own
 * row, so this is the state `loadLocalResources` will commit again.
 */
export function commitHostWorkspace(workspace: WorkspaceInfo | undefined): void {
  queryClient.setQueryData<HostState>(keys.host, (host) =>
    host === undefined ? host : { ...host, workspace },
  );
}

/** Refill workspace caches after a host transition, committing host state last. */
export async function loadLocalResources(): Promise<void> {
  const version = ++localLoadVersion;
  const [host, workspaces, catalog, sessionDirectory] = await Promise.all([
    readHost(),
    readWorkspaces(),
    readCatalog(),
    readSessionDirectory(),
  ]);
  if (version !== localLoadVersion) return;

  const workspaceScopes = new Set(["vcs", "files", "github", "plugins", "customize"]);
  queryClient.removeQueries({
    predicate: (query) => workspaceScopes.has(String(query.queryKey[0])),
  });
  queryClient.removeQueries({ queryKey: ["sessions", "search"] });
  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.catalog, catalog);
  queryClient.setQueryData(keys.sessionDirectory, sessionDirectory);
  queryClient.setQueryData(keys.sessionPreview, {
    items: localSessions(sessionDirectory, host.workspace?.path ?? null) ?? [],
  } satisfies SessionPage);
  for (const directory of sessionDirectory) {
    for (const session of directory.sessions)
      queryClient.setQueryData(keys.session(session.sessionId), session);
  }
  // Commit host last. Home and projects both find their local session cache filled.
  queryClient.setQueryData(keys.host, host);
  // The plugin catalog activates the folder's plugins on first read; that
  // work fills the composer's suggestions behind the mounted screen rather
  // than holding it, and one malformed plugin cannot keep the shell from loading.
  void queryClient
    .prefetchQuery({ queryKey: keys.pluginCatalog, queryFn: readPluginCatalog })
    .catch(() => undefined);
}

/**
 * Every list that shows this session takes the new row now: the sidebar reads
 * the directory, which otherwise only learns of a run's phase on its 5s poll,
 * and a short run would end before that tick ever saw it start. The observer
 * calls this with each session row its reads and events produce.
 */
export function cacheSessionInfo(session: SessionInfo): void {
  sessionObservations.observe(session.sessionId, performance.now());
  const replace = (sessions: readonly SessionInfo[]): readonly SessionInfo[] =>
    sessions.map((candidate) => (candidate.sessionId === session.sessionId ? session : candidate));
  queryClient.setQueryData(keys.session(session.sessionId), session);
  queryClient.setQueryData<SessionPage>(keys.sessionPreview, (preview) =>
    preview === undefined ? preview : { ...preview, items: replace(preview.items) },
  );
  queryClient.setQueryData<readonly WorkspaceSessionDirectory[]>(
    keys.sessionDirectory,
    (directories) =>
      directories?.map((directory) => ({ ...directory, sessions: replace(directory.sessions) })),
  );
  if (session.parent !== undefined) {
    queryClient.setQueryData<readonly SessionInfo[]>(
      keys.childSessions(session.parent.sessionId),
      (children) => (children === undefined ? children : replace(children)),
    );
  }
}

export async function cacheCreatedSession({
  session,
  workspacePath,
}: {
  readonly session: SessionInfo;
  readonly workspacePath: string | null;
}): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: keys.sessionDirectory, exact: true }),
    queryClient.cancelQueries({ queryKey: keys.sessionPreview, exact: true }),
  ]);
  const insert = (sessions: readonly SessionInfo[]) => [
    session,
    ...sessions.filter((candidate) => candidate.sessionId !== session.sessionId),
  ];
  sessionObservations.observe(session.sessionId, performance.now());
  queryClient.setQueryData(keys.session(session.sessionId), session);
  queryClient.setQueryData<SessionPage>(keys.sessionPreview, (preview) => ({
    ...preview,
    items: insert(preview?.items ?? []),
  }));
  queryClient.setQueryData<readonly WorkspaceSessionDirectory[]>(
    keys.sessionDirectory,
    (directories) =>
      directories?.map((directory) =>
        directory.environment === "local" && directory.workspacePath === workspacePath
          ? { ...directory, sessions: insert(directory.sessions) }
          : directory,
      ),
  );
}

/** Share pending configuration with the draft-to-session handoff. */
export function configureSession(sessionId: SessionId, patch: ConfigureSessionPatch) {
  return queryClient
    .getMutationCache()
    .build(
      queryClient,
      sessionConfigurationOptions({
        client: queryClient,
        sessions: nyte.sessions,
        sessionId,
        selection: sessionSelection(sessionId),
      }),
    )
    .execute(patch);
}

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(
    sessionConfigurationOptions({
      client: useQueryClient(),
      sessions: nyte.sessions,
      sessionId,
      selection: sessionSelection(sessionId),
    }),
  );
}

export type CustomizeInventory = Pick<PluginCatalog, "plugins" | "settings" | "skills">;

interface ApplyPluginSettingInput {
  readonly id: string;
  readonly choiceId: string;
}

export function usePluginSettingsProjection(sessionId: SessionId | undefined) {
  const pending = useMutationState<MutationState<void, Error, ApplyPluginSettingInput>>({
    filters: { mutationKey: ["plugins", "apply", sessionId], status: "pending" },
  });
  return (settings: readonly SettingInfo[]): readonly SettingInfo[] =>
    pending.reduce((current, mutation) => {
      const input = mutation.variables;
      return input === undefined
        ? current
        : current.map((setting) =>
            setting.id === input.id ? { ...setting, current: input.choiceId } : setting,
          );
    }, settings);
}

export function usePluginSettings(sessionId: SessionId, enabled = true) {
  const project = usePluginSettingsProjection(sessionId);
  return useQuery({
    queryKey: keys.pluginSettings(sessionId),
    queryFn: () => nyte.plugins.settings.list({ sessionId }),
    select: project,
    enabled,
    staleTime: SNAPSHOT_WARM_MS,
    refetchOnMount: true,
  });
}

export function useApplyPluginSetting(sessionId: SessionId | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["plugins", "apply", sessionId],
    scope: { id: `plugin-settings:${sessionId}` },
    mutationFn: async ({ id, choiceId }: ApplyPluginSettingInput) => {
      if (sessionId === undefined) throw new Error("Open a chat to change its settings");
      const outcome = await nyte.plugins.settings.apply({ sessionId, id, choiceId });
      if (outcome.kind === "not_found") throw new Error("That setting is no longer available");
      if (outcome.kind === "invalid_choice") throw new Error("That setting value is not valid");
    },
    onSuccess: async (_result, input) => {
      if (sessionId === undefined) return;
      await Promise.all([
        client.cancelQueries({ queryKey: keys.pluginSettings(sessionId), exact: true }),
        client.cancelQueries({ queryKey: ["customize", sessionId], exact: true }),
      ]);
      const update = (settings: readonly SettingInfo[]) =>
        settings.map((setting) =>
          setting.id === input.id ? { ...setting, current: input.choiceId } : setting,
        );
      client.setQueryData<readonly SettingInfo[]>(keys.pluginSettings(sessionId), (settings) =>
        settings === undefined ? settings : update(settings),
      );
      client.setQueryData<CustomizeInventory>(["customize", sessionId], (inventory) =>
        inventory === undefined
          ? inventory
          : { ...inventory, settings: update(inventory.settings) },
      );
    },
    onError: () =>
      toast.error("Couldn't change that setting. Try again.", { id: "plugin-setting-error" }),
    onSettled: () => {
      if (sessionId === undefined) return;
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.pluginSettings(sessionId), exact: true }),
        client.invalidateQueries({ queryKey: ["customize", sessionId], exact: true }),
      ]);
    },
  });
}

export function useRenameSession() {
  const actions = useSessionActions();
  return useMutation({
    mutationFn: (input: { sessionId: SessionId; name: string }) => actions.rename(input),
  });
}
