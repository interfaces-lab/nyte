// TanStack Query over the SDK operations. Startup seeds local data before mounting
// the shell. Watches invalidate settled data; what has no watch operation yet
// (the session directory, jobs, children, VCS status) polls on a slow interval.
import {
  QueryClient,
  queryOptions,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { projectPreference } from "./preference-projection.ts";
import { useSyncExternalStore } from "react";
import { keys } from "./query-keys.ts";
import { SessionActions } from "./session-actions.ts";
import {
  projectSessionConfiguration,
  sessionConfigurationOptions,
} from "./session-configuration.ts";
import type { ConfigureSessionPatch, PendingConfiguration } from "./session-configuration.ts";
export { keys } from "./query-keys.ts";
import { toast } from "@nyte-ai/ui/sonner";
import type { MentionFile } from "@nyte-ai/core/views";
import type {
  JobInfo,
  PluginCatalog,
  SessionId,
  SessionInfo,
  SettingInfo,
  VcsDiff,
  WorkspaceInfo,
} from "@nyte-ai/core";
import { localSessions } from "../../shared/ipc.ts";
import type {
  DesktopCatalog,
  DesktopVcsSnapshot,
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
import { SessionObservations } from "./session-freshness.ts";
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

const sessionActionsByClient = new WeakMap<QueryClient, SessionActions>();

function actionsFor(client: QueryClient): SessionActions {
  const existing = sessionActionsByClient.get(client);
  if (existing !== undefined) return existing;
  const actions = new SessionActions({ client, sessions: nyte.sessions });
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

/** How long cached content of a session counts as current for a paint before a fresh read. */
export const SNAPSHOT_WARM_MS = 1_000;

const readHost = () => nyte.host.state();
const readWorkspaces = () => nyte.workspace.list();
const sessionObservations = new SessionObservations();

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

export function useServerState() {
  return useQuery({
    queryKey: keys.server,
    queryFn: (): Promise<ServerState> => nyte.host.server.state(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
}

export function useMobileShareState() {
  return useQuery({
    queryKey: keys.mobileShare,
    queryFn: (): Promise<MobileShareState> => nyte.host.mobile.state(),
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

/**
 * The jobs of one chat. Job events invalidate this; the poll while one runs
 * covers a job that settles without an event reaching this window.
 */
export function useJobs(sessionId: SessionId | undefined) {
  return useQuery({
    queryKey: keys.jobs(sessionId),
    queryFn: (): Promise<readonly JobInfo[]> =>
      sessionId === undefined ? Promise.resolve([]) : nyte.jobs.list({ sessionId }),
    enabled: sessionId !== undefined,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.state === "running") === true ? 2_000 : false,
  });
}

export function useVcsSnapshot(enabled: boolean) {
  return useQuery<DesktopVcsSnapshot>({
    queryKey: keys.vcsSnapshot,
    queryFn: () => nyte.host.vcs.snapshot(),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

export interface VcsDiffIdentity {
  readonly repositoryId: string;
  readonly revision: string;
  readonly path: string;
}

interface VcsDiffsIdentity {
  readonly repositoryId: string;
  readonly revision: string;
  readonly paths: readonly string[];
}

export function useVcsDiffs(identity: VcsDiffsIdentity | undefined, enabled: boolean) {
  const pathsKey = identity === undefined ? "" : [...identity.paths].toSorted().join("\0");
  return useQuery<readonly VcsDiff[]>({
    queryKey:
      identity === undefined
        ? keys.vcsDiffs("unavailable", "unavailable", "")
        : keys.vcsDiffs(identity.repositoryId, identity.revision, pathsKey),
    queryFn: async () => {
      if (identity === undefined) return [];
      return nyte.workspace.vcs.diff({ paths: [...identity.paths] });
    },
    enabled: enabled && identity !== undefined && identity.paths.length > 0,
  });
}

export function refreshVcs(): void {
  void queryClient.invalidateQueries({ queryKey: ["vcs"] });
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
      void client.invalidateQueries({ queryKey: ["vcs"] });
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
    gcTime: Infinity,
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
