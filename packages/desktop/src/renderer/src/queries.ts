// TanStack Query over the SDK verbs. Startup seeds local data before mounting
// the shell. Watches invalidate settled data; queries never poll except
// for the session directory, which has no cross-session watch verb yet.
import {
  QueryClient,
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
export { keys } from "./query-keys.ts";
import { toast } from "@nyte-ai/ui/sonner";
import type {
  FileChange,
  MentionFile,
  PluginCatalog,
  Seq,
  SessionId,
  SessionInfo,
  SessionSnapshot,
  SettingInfo,
  ThinkingLevel,
  VcsDiff,
} from "@nyte-ai/core";
import type {
  DesktopCatalog,
  DesktopVcsSnapshot,
  GitHubProviderState,
  PreferenceChange,
} from "../../shared/ipc.ts";
import { loadSessionDirectory, type SessionPage } from "./session-directory.ts";
import { nyte } from "./nyte.ts";

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

const SNAPSHOT_WARM_MS = 1_000;

const readHost = () => nyte.host.state();
const readWorkspaces = () => nyte.workspace.list();
const readSessionPreview = () => loadSessionDirectory((input) => nyte.sessions.list(input));
const readSessionDirectory = () => nyte.host.sessionDirectory();
const readCatalog = () => nyte.host.catalog();
const readPluginCatalog = (): Promise<PluginCatalog> => nyte.plugins.catalog();
const readSession = async (sessionId: SessionId) =>
  (await nyte.sessions.get({ sessionId })) ?? null;
const readSnapshot = async (sessionId: SessionId): Promise<SessionSnapshot> => {
  const snapshot = await nyte.sessions.snapshot({ sessionId });
  if (snapshot === undefined) throw new Error(`Unknown session: ${sessionId}`);
  return snapshot;
};

export function useHostState() {
  return useQuery({ queryKey: keys.host, queryFn: readHost });
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
    // No directory watch verb yet; a slow tick keeps liveness honest.
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useSessionSearch(search: string, enabled = true) {
  const projection = useSessionProjection();
  const normalized = search.trim();
  return useQuery({
    queryKey: keys.sessionSearch(normalized),
    queryFn: () => nyte.sessions.list({ search: normalized, limit: 50 }),
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
  return useQuery({
    queryKey: keys.snapshot(sessionId),
    queryFn: () => readSnapshot(sessionId),
    select: (snapshot) => ({
      ...snapshot,
      session: projection.session(snapshot.session) ?? snapshot.session,
    }),
    // Cached content paints immediately. Old local data refreshes behind the
    // page instead of becoming a navigation gate.
    staleTime: SNAPSHOT_WARM_MS,
    refetchOnMount: true,
  });
}

export function useRunChanges(sessionId: SessionId | undefined, enabled = true) {
  return useQuery<readonly FileChange[]>({
    queryKey: sessionId === undefined ? keys.workspaceChanges : keys.changes(sessionId),
    queryFn: () =>
      sessionId === undefined ? Promise.resolve([]) : nyte.runs.changes({ sessionId }),
    enabled: enabled && sessionId !== undefined,
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

export function vcsDiffQueryKey(identity: VcsDiffIdentity) {
  return keys.vcsDiff(identity.repositoryId, identity.revision, identity.path);
}

export function useVcsDiff(identity: VcsDiffIdentity | undefined, enabled: boolean) {
  return useQuery<VcsDiff | undefined>({
    queryKey:
      identity === undefined
        ? keys.vcsDiff("unavailable", "unavailable", "")
        : vcsDiffQueryKey(identity),
    queryFn: async () => {
      if (identity === undefined) return undefined;
      return (await nyte.workspace.vcs.diff({ paths: [identity.path] }))[0];
    },
    enabled: enabled && identity !== undefined,
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
export function useMentionFiles(enabled: boolean) {
  return useQuery<readonly MentionFile[]>({
    queryKey: keys.mentionFiles,
    queryFn: () => nyte.host.files.list(),
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/** Providers, models, and the defaults a new chat starts with, in one read. */
export function useCatalog() {
  const pending = useMutationState<MutationState<DesktopCatalog, Error, PreferenceChange>>({
    filters: { mutationKey: ["catalog", "preference"], status: "pending" },
  });
  return useQuery({
    queryKey: keys.catalog,
    queryFn: readCatalog,
    select: (catalog) =>
      pending.reduce(
        (current, mutation) =>
          mutation.variables === undefined
            ? current
            : projectPreference(current, mutation.variables),
        catalog,
      ),
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

export function useGitHubState(enabled: boolean) {
  return useQuery<GitHubProviderState>({
    queryKey: keys.github,
    queryFn: () => nyte.host.github.state(),
    enabled,
  });
}

export async function refreshGitHub(): Promise<GitHubProviderState> {
  const state = await nyte.host.github.refresh();
  queryClient.setQueryData(keys.github, state);
  return state;
}

export async function signInGitHub(): Promise<GitHubProviderState> {
  const state = await nyte.host.github.signIn();
  queryClient.setQueryData(keys.github, state);
  return state;
}

export async function signOutGitHub(): Promise<GitHubProviderState> {
  const state = await nyte.host.github.signOut();
  queryClient.setQueryData(keys.github, state);
  return state;
}

let localLoadVersion = 0;

/** Refill workspace caches after a host transition, committing host state last. */
export async function loadLocalResources(): Promise<void> {
  const version = ++localLoadVersion;
  const [host, workspaces, catalog, pluginCatalog, sessionDirectory] = await Promise.all([
    readHost(),
    readWorkspaces(),
    readCatalog(),
    // Plugin metadata improves first paint, but one malformed local plugin
    // must not prevent the workspace shell from loading.
    readPluginCatalog().catch(() => undefined),
    readSessionDirectory(),
  ]);
  if (version !== localLoadVersion) return;

  const workspaceScopes = new Set(["changes", "vcs", "files", "github", "plugins", "customize"]);
  queryClient.removeQueries({
    predicate: (query) => workspaceScopes.has(String(query.queryKey[0])),
  });
  queryClient.removeQueries({ queryKey: ["sessions", "search"] });
  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.catalog, catalog);
  if (pluginCatalog !== undefined) queryClient.setQueryData(keys.pluginCatalog, pluginCatalog);
  queryClient.setQueryData(keys.sessionDirectory, sessionDirectory);
  const activeDirectory = sessionDirectory.find(
    (entry) => entry.workspacePath === (host.workspace?.path ?? null),
  );
  queryClient.setQueryData(keys.sessionPreview, {
    items: activeDirectory?.sessions ?? [],
  } satisfies SessionPage);
  for (const directory of sessionDirectory) {
    for (const session of directory.sessions)
      queryClient.setQueryData(keys.session(session.sessionId), session);
  }
  // Commit host last. Home and projects both find their local session cache filled.
  queryClient.setQueryData(keys.host, host);
}

function cacheSnapshotSession(snapshot: SessionSnapshot): void {
  queryClient.setQueryData(keys.session(snapshot.session.sessionId), snapshot.session);
  queryClient.setQueryData<SessionPage>(keys.sessionPreview, (preview) =>
    preview === undefined
      ? preview
      : {
          ...preview,
          items: preview.items.map((session) =>
            session.sessionId === snapshot.session.sessionId ? snapshot.session : session,
          ),
        },
  );
}

async function fetchThreadSnapshot(
  sessionId: SessionId,
  staleTime: number,
): Promise<SessionSnapshot> {
  const snapshot = await queryClient.fetchQuery({
    queryKey: keys.snapshot(sessionId),
    queryFn: () => readSnapshot(sessionId),
    staleTime,
  });
  cacheSnapshotSession(snapshot);
  return snapshot;
}

/** Force one coherent snapshot after a mutation that needs its result. */
export function loadThread(sessionId: SessionId): Promise<SessionSnapshot> {
  return fetchThreadSnapshot(sessionId, 0);
}

interface ThreadRefreshState {
  dirty: boolean;
  requiredSeq: Seq | undefined;
}

const threadRefreshes = new Map<SessionId, ThreadRefreshState>();

/**
 * Refresh every settled thread field through the same one-call projection.
 * Replay can deliver many durable events together. Keep one local snapshot
 * read in flight and, if another event lands during it, do one follow-up read
 * so the cache cannot finish behind the newest commit.
 */
export function refreshThread(sessionId: SessionId, requiredSeq?: Seq): void {
  const active = threadRefreshes.get(sessionId);
  if (active !== undefined) {
    active.dirty = true;
    if (
      requiredSeq !== undefined &&
      (active.requiredSeq === undefined || requiredSeq > active.requiredSeq)
    ) {
      active.requiredSeq = requiredSeq;
    }
    return;
  }

  const state: ThreadRefreshState = { dirty: false, requiredSeq };
  threadRefreshes.set(sessionId, state);
  const drain = async (): Promise<void> => {
    do {
      state.dirty = false;
      const [, , , snapshot] = await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.changes(sessionId), exact: true }),
        queryClient.invalidateQueries({ queryKey: ["vcs"] }),
        queryClient.invalidateQueries({ queryKey: keys.mentionFiles, exact: true }),
        fetchThreadSnapshot(sessionId, 0),
      ]);
      if (state.requiredSeq !== undefined && snapshot.seq < state.requiredSeq) state.dirty = true;
    } while (state.dirty);
  };

  void drain()
    .catch(() => undefined)
    .finally(() => {
      if (threadRefreshes.get(sessionId) === state) threadRefreshes.delete(sessionId);
    });
}

/** Refresh old local data on intent without making navigation wait for it. */
export function warmThread(sessionId: SessionId): void {
  void fetchThreadSnapshot(sessionId, SNAPSHOT_WARM_MS).catch(() => undefined);
}

interface ConfigureSessionPatch {
  readonly model?: { readonly provider: string; readonly id: string };
  readonly thinkingLevel?: ThinkingLevel;
}

interface ConfigureRollback {
  readonly session: SessionInfo | null | undefined;
  readonly snapshot: SessionSnapshot | undefined;
  readonly sessionPreview: SessionPage | undefined;
}

function withSessionConfig(session: SessionInfo, patch: ConfigureSessionPatch): SessionInfo {
  return { ...session, config: { ...session.config, ...patch } };
}

/** Configure live run inputs through Query so every session projection moves together. */
export function useConfigureSession(sessionId: SessionId) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["session", sessionId, "configure"],
    scope: { id: `session-config:${sessionId}` },
    mutationFn: async (patch: ConfigureSessionPatch) => {
      const outcome = await nyte.sessions.configure({ sessionId, ...patch });
      if (outcome.kind === "unknown_model") throw new Error("That model is no longer available");
      return outcome;
    },
    onMutate: (patch): ConfigureRollback => {
      const session = client.getQueryData<SessionInfo | null>(keys.session(sessionId));
      const snapshot = client.getQueryData<SessionSnapshot>(keys.snapshot(sessionId));
      const sessionPreview = client.getQueryData<SessionPage>(keys.sessionPreview);

      client.setQueryData<SessionInfo | null>(keys.session(sessionId), (current) =>
        current === null || current === undefined ? current : withSessionConfig(current, patch),
      );
      client.setQueryData<SessionSnapshot>(keys.snapshot(sessionId), (current) =>
        current === undefined
          ? current
          : {
              ...current,
              session: withSessionConfig(current.session, patch),
              config:
                current.run !== undefined &&
                !["done", "aborted", "failed"].includes(current.run.phase.kind)
                  ? current.config
                  : { ...current.config, ...patch },
            },
      );
      client.setQueryData<SessionPage>(keys.sessionPreview, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((item) =>
                item.sessionId === sessionId ? withSessionConfig(item, patch) : item,
              ),
            },
      );
      return { session, snapshot, sessionPreview };
    },
    onError: (_error, _patch, rollback) => {
      if (rollback === undefined) return;
      client.setQueryData(keys.session(sessionId), rollback.session);
      client.setQueryData(keys.snapshot(sessionId), rollback.snapshot);
      client.setQueryData(keys.sessionPreview, rollback.sessionPreview);
    },
    onSettled: () => {
      refreshThread(sessionId);
      void client.invalidateQueries({ queryKey: keys.pluginSettings(sessionId) });
    },
  });
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
