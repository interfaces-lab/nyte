/**
 * TanStack Query over the connection's one-shot reads. Startup connects and
 * seeds local data before mounting the shell; everything that changes without
 * this client's action is a shared watch from `sdk.tsx`, never an invalidation.
 */
import {
  QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { asId } from "@nyte-ai/schema";
import { toast } from "@nyte-ai/ui/toast";
import type {
  ChangeSet,
  Connection,
  Cursor,
  FilesApi,
  FileVersion,
  GitApi,
  GitScope,
  Json,
  ModelCatalogView,
  ModelRef,
  PatchEntry,
  PatchSet,
  RunId,
  SearchFrame,
  SessionId,
  SessionInfo,
  SessionView,
  SettingInfo,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/sdk";
import { keys } from "./query-keys.ts";
import { missingAsNull } from "./route-session.ts";
import { SessionActions } from "./session-actions.ts";
import { projectSessionChoice, sessionConfigurationOptions } from "./session-configuration.ts";
import type { ConfigureSessionPatch, PendingConfiguration } from "./session-configuration.ts";
import type {
  HostState,
  SelectedWorkspace,
  UpdateState,
  UsageSnapshot,
  UsageWindow,
} from "./bridge.ts";
import { groupDirectory } from "./session-directory.ts";
import type { WorkspaceSessionDirectory } from "./session-directory.ts";
import { nyte } from "./nyte.ts";
import {
  childrenWatch,
  connectHost,
  connection,
  currentConnection,
  directoryWatch,
  gitStatusWatch,
  hostWatch,
  jobsWatch,
  sessionWatch,
  useWatch,
} from "./sdk.tsx";
import { USAGE_STALE_AFTER_MS } from "./chrome/usage-view.ts";
import { catalogOf } from "./catalog.ts";
import { workspaceName, workspacePath } from "./view-helpers.ts";
import { mentionFile } from "./conversation/message-references.ts";
import type { MentionFile } from "./conversation/message-references.ts";
import type { DesktopCatalog } from "./catalog.ts";

export { keys } from "./query-keys.ts";

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
  const actions = new SessionActions({ client });
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

const readHost = () => nyte.host.state();

const readWorkspaces = () => connection().workspaces.list();

const readCatalog = async (): Promise<DesktopCatalog> =>
  catalogOf(await connection().models.list());

/** The selected folder's workspace id; Home has none. */
export function selectedWorkspaceId(): WorkspaceId | undefined {
  return queryClient.getQueryData<HostState>(keys.host)?.workspace?.id;
}

/** The folder a listed session's workspace lives in: its path, null for one no local folder backs, undefined when unlisted. */
export function sessionFolderPath(sessionId: SessionId): string | null | undefined {
  const session = directoryWatch("all").value?.find((candidate) => candidate.id === sessionId);

  if (session === undefined) return undefined;
  const workspace = queryClient
    .getQueryData<readonly WorkspaceInfo[]>(keys.workspaces)
    ?.find((candidate) => candidate.id === session.workspace);

  return workspace === undefined ? null : workspacePath(workspace);
}

/** The selected folder's files capability, or the reason it has none. */
export async function workspaceFiles(): Promise<FilesApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its files");
  const capability = await connection().workspace(id).files();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

/** The selected folder's git capability, or the reason it has none. */
export async function workspaceGit(): Promise<GitApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its repository");
  const capability = await connection().workspace(id).git();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

export const readSession = (sessionId: SessionId) => connection().session(sessionId).info();

export function useHostState() {
  return useQuery({ queryKey: keys.host, queryFn: readHost });
}

export function useUpdateState() {
  return useQuery({
    queryKey: keys.updates,
    queryFn: async (): Promise<UpdateState> => nyte.host.updates?.state() ?? { kind: "idle" },
  });
}

export function setUpdateStateForDemo(state: UpdateState): void {
  queryClient.setQueryData(keys.updates, state);
}

export function useServerState(active: boolean) {
  return useQuery({
    queryKey: keys.server,
    queryFn: () => nyte.host.server.state(),
    staleTime: active ? 0 : Infinity,
    refetchInterval: active ? 15_000 : false,
    refetchOnWindowFocus: active ? "always" : false,
    refetchOnMount: active ? "always" : false,
  });
}

export function useRemoteAccessState(active: boolean) {
  return useQuery({
    queryKey: keys.remoteAccess,
    queryFn: () => nyte.host.remote.state(),
    enabled: active,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
}

/** A registered workspace as the rail lists it: its folder's path and name, and whether it is reachable. */
export interface RailWorkspace extends SelectedWorkspace {
  readonly available: boolean;
}

/** The host's registered local workspaces, as the rail lists them; a forget in flight hides its row. */
export function useWorkspaces() {
  const pending = useMutationState<MutationState<void, Error, WorkspaceId>>({
    filters: { mutationKey: ["workspace", "forget"], status: "pending" },
  });

  return useQuery({
    queryKey: keys.workspaces,
    queryFn: readWorkspaces,
    select: (workspaces): readonly RailWorkspace[] =>
      workspaces.flatMap((workspace) => {
        const path = workspacePath(workspace);

        return path === null || pending.some((mutation) => mutation.variables === workspace.id)
          ? []
          : [
              {
                id: workspace.id,
                path,
                name: workspaceName(workspace),
                available: workspace.availability.kind === "available",
              },
            ];
      }),
  });
}

/** Drop a workspace from the rail. Forgetting the selected workspace returns the view to Home. */
export function useForgetWorkspace() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["workspace", "forget"],
    mutationFn: async (id: WorkspaceId) => {
      const outcome = await connection().workspaces.forget(id);

      if (outcome.kind === "busy") throw new Error("Chats still use this workspace");
    },
    onSuccess: async (_result, id) => {
      await client.cancelQueries({ queryKey: keys.workspaces, exact: true });
      client.setQueryData<readonly WorkspaceInfo[]>(keys.workspaces, (workspaces) =>
        workspaces?.filter((workspace) => workspace.id !== id),
      );
      toast.add({
        type: "success",
        title: "Workspace removed from sidebar",
        id: "workspace-forgotten",
      });
    },
    onError: () =>
      toast.add({
        type: "error",
        title: "Couldn't remove this workspace. Try again.",
        id: "workspace-forget-error",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

/** The root sessions, as the directory watch yields them, with pending edits projected. */
export function useRootSessions(): readonly SessionInfo[] | undefined {
  const projection = useSessionProjection();
  const all = useWatch(directoryWatch("all"));

  return useMemo(
    () =>
      all === undefined
        ? undefined
        : projection.list(all.filter((session) => session.parent === null)),
    [all, projection],
  );
}

const NO_SESSIONS: ReadonlySet<SessionId> = new Set();

/**
 * Roots to draw as working whatever their own head says: a session a child
 * still works for. The directory lists every session with its parent, so a
 * busy child marks each ancestor.
 */
export function useWorkingSessionIds(): ReadonlySet<SessionId> {
  const all = useWatch(directoryWatch("all"));

  return useMemo(() => {
    if (all === undefined) return NO_SESSIONS;
    const parents = new Map(all.map((session) => [session.id, session.parent]));
    const working = new Set<SessionId>();

    for (const session of all) {
      if (session.heads.every((head) => head.execution.kind === "idle")) continue;

      for (let parent = session.parent; parent !== null; parent = parents.get(parent) ?? null) {
        if (working.has(parent)) break;
        working.add(parent);
      }
    }

    return working;
  }, [all]);
}

/** The root sessions grouped by the workspace they live in, Home first. */
export function useWorkspaceSessionDirectory(): {
  readonly data: readonly WorkspaceSessionDirectory[] | undefined;
} {
  const roots = useRootSessions();
  const workspaces = useWorkspaces();

  return useMemo(
    () => ({
      data: roots === undefined ? undefined : groupDirectory(roots, workspaces.data ?? []),
    }),
    [roots, workspaces.data],
  );
}

/** Sessions matching a search, from the directory the sidebar already holds. */
export function useSessionSearch(search: string, enabled = true) {
  const roots = useRootSessions();
  const needle = search.trim().toLocaleLowerCase();

  return useMemo(
    () => ({
      data:
        !enabled || needle === "" || roots === undefined
          ? undefined
          : {
              items: roots.filter(
                (session) =>
                  !session.archived && (session.name ?? "").toLocaleLowerCase().includes(needle),
              ),
            },
    }),
    [enabled, needle, roots],
  );
}

/** One session's directory row: the directory's when it lists it, else one read; null when the host has none. */
export function useSession(sessionId: SessionId | undefined) {
  const projection = useSessionProjection();
  const roots = useWatch(directoryWatch("all"));
  const listed = roots?.find((session) => session.id === sessionId);

  const read = useQuery({
    queryKey: keys.session(sessionId ?? asId<"session">("")),
    queryFn: () => (sessionId === undefined ? null : readSession(sessionId).catch(missingAsNull)),
    enabled: listed === undefined && sessionId !== undefined,
  });

  const row = listed ?? read.data;

  return {
    ...read,
    data: row === undefined || row === null ? row : projection.session(row),
  };
}

/** One session's view, watched while mounted, with pending model choices projected. */
export function useSessionView(sessionId: SessionId | undefined): SessionView | undefined {
  return useWatch(sessionId === undefined ? undefined : sessionWatch(sessionId));
}

/** Opens a session's watch from route intent and resolves with its first view, or at once when one is held. */
export async function warmSession(sessionId: SessionId): Promise<void> {
  const store = sessionWatch(sessionId);

  if (store.value === undefined) await store.next();
}

/** The model and thinking a session runs with: what it selected, with pending choices painted over it. */
export function useSessionChoice(sessionId: SessionId) {
  const view = useSessionView(sessionId);
  const pending = useMutationState<PendingConfiguration>({
    filters: { mutationKey: ["session", sessionId, "configure"], status: "pending" },
  });

  return view === undefined ? undefined : projectSessionChoice(view, pending);
}

/** The child sessions one chat delegated to, as the directory watch yields them. */
export function useChildSessions(sessionId: SessionId | undefined) {
  const children = useWatch(sessionId === undefined ? undefined : childrenWatch(sessionId));

  return { data: children };
}

/** The selected workspace's jobs, watched while mounted. */
export function useWorkspaceJobs(workspace: WorkspaceId | undefined) {
  return useWatch(workspace === undefined ? undefined : jobsWatch(workspace));
}

/** The files a comparison changes at the repository revision the status names. */
export function useVcsChanges(
  scope: GitScope | undefined,
  ignoreWhitespace: boolean,
  revision: string | undefined,
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data?.workspace?.id;

  return useQuery<ChangeSet>({
    queryKey: keys.gitChanges(workspace, scope, ignoreWhitespace, revision),
    queryFn: async () => {
      if (scope === undefined) throw new Error("Choose what to compare");

      return (await workspaceGit()).changes(scope, { ignoreWhitespace });
    },
    enabled: enabled && scope !== undefined && workspace !== undefined,
    placeholderData: (previous) => previous,
  });
}

/** A page of history, newest first; `cursor` continues where the previous page ended. */
export function useVcsLog(
  input: { readonly limit: number; readonly cursor?: Cursor | undefined },
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data?.workspace?.id;

  return useQuery({
    queryKey: keys.gitLog(workspace, input.limit, input.cursor),
    queryFn: async () =>
      (await workspaceGit()).log({
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }),
    enabled: enabled && workspace !== undefined,
    staleTime: 0,
  });
}

/** Branches, tags and remotes. */
export function useVcsRefs(enabled: boolean) {
  const host = useHostState();
  const workspace = host.data?.workspace?.id;

  return useQuery({
    queryKey: keys.gitRefs(workspace),
    queryFn: async () => (await workspaceGit()).refs(),
    enabled: enabled && workspace !== undefined,
    staleTime: 0,
  });
}

/** What one run changed, from the environment's recorded snapshots. */
export function useRunChanges(input: {
  readonly workspace: WorkspaceId | undefined;
  readonly runId: RunId | undefined;
  readonly live: boolean;
  readonly enabled?: boolean;
}) {
  const { workspace, runId, live, enabled = true } = input;

  return useQuery<ChangeSet>({
    queryKey: keys.runChanges(workspace, runId, live),
    queryFn: () => {
      if (workspace === undefined || runId === undefined) throw new Error("No run to compare");

      return connection().workspace(workspace).changes(runId);
    },
    enabled: enabled && workspace !== undefined && runId !== undefined,
    staleTime: live ? 0 : "static",
  });
}

/**
 * The first patch set that answers every requested path freshly, from a
 * `patches` stream; the stream closes once it has.
 */
async function firstPatches(
  stream: AsyncIterable<PatchSet>,
  paths: readonly string[],
): Promise<readonly PatchEntry[]> {
  for await (const set of stream) {
    const entries = paths.flatMap((path) => {
      const entry = set.entries.get(path);

      return entry === undefined || !entry.fresh ? [] : [entry];
    });

    if (entries.length === paths.length) return entries;
  }

  return [];
}

/** Parsed patches for paths under a git scope of the selected workspace. */
export async function readGitPatches(
  scope: GitScope,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  return firstPatches((await workspaceGit()).patches(scope, paths, { ignoreWhitespace }), paths);
}

/** Parsed patches for paths one run changed, from the environment's recorded snapshots. */
export function readRunPatches(
  workspace: WorkspaceId,
  run: RunId,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  return firstPatches(
    connection().workspace(workspace).patches(run, paths, { ignoreWhitespace }),
    paths,
  );
}

/** Every file in the selected workspace, as `@` names it, for mentions and the file tree. */
async function scanFiles(): Promise<readonly MentionFile[]> {
  const root = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const files = await workspaceFiles();
  const entries: MentionFile[] = [];

  if (root === undefined) return entries;

  for await (const frame of files.scan({ ignored: "exclude" })) {
    if (frame.kind === "entries")
      entries.push(...frame.entries.map((entry) => mentionFile(root, entry)));
  }

  return entries;
}

/** The user asked for a fresh look: the file list and open documents are read again. */
export function refreshVcs(): void {
  void queryClient.invalidateQueries({ queryKey: keys.mentionFiles, exact: true });
  void queryClient.invalidateQueries({ queryKey: ["files", "document"] });
}

/** The selected workspace's git status, watched while mounted. */
export function useVcsSnapshot(enabled: boolean) {
  const host = useHostState();
  const workspace = host.data?.workspace?.id;

  return {
    data: useWatch(enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined),
  };
}

export function mentionFilesOptions(enabled: boolean) {
  return {
    queryKey: keys.mentionFiles,
    queryFn: scanFiles,
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  } as const;
}

export function useMentionFiles(enabled: boolean) {
  return useQuery(mentionFilesOptions(enabled));
}

export function useWorkspaceFile(path: string | undefined) {
  return useQuery({
    queryKey: keys.workspaceFile(path ?? ""),
    queryFn: async () => {
      if (path === undefined) throw new Error("Select a file to open it");

      return (await workspaceFiles()).read(path);
    },
    enabled: path !== undefined,
    staleTime: 1_000,
  });
}

/** Content matches for a query: every match the host yields, and whether it stopped at a limit. */
export function useWorkspaceSearch(
  input: { readonly query: string; readonly limit?: number } | undefined,
  enabled = true,
) {
  const host = useHostState();
  const workspace = host.data?.workspace?.id;

  return useQuery({
    queryKey: keys.workspaceSearch(workspace ?? "", input),
    queryFn: async () => {
      if (input === undefined) throw new Error("Type to search");
      const matches: Extract<SearchFrame, { readonly kind: "match" }>[] = [];
      let truncated = false;

      for await (const frame of (await workspaceFiles()).search(input)) {
        if (frame.kind === "match") matches.push(frame);

        if (frame.kind === "truncated") truncated = true;
      }

      return { matches, truncated };
    },
    enabled: enabled && workspace !== undefined && input !== undefined && input.query.length > 0,
    staleTime: 0,
    refetchOnMount: true,
    gcTime: 0,
  });
}

export function useSaveWorkspaceFile() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["files", "save"],
    mutationFn: async (input: {
      readonly path: string;
      readonly contents: string;
      readonly expect?: FileVersion | "absent";
    }) =>
      (await workspaceFiles()).write(
        input.path,
        input.contents,
        input.expect === undefined ? undefined : { expect: input.expect },
      ),
    onSuccess: (outcome, input) => {
      if (outcome.kind !== "saved") return;
      client.setQueryData(keys.workspaceFile(input.path), {
        kind: "text" as const,
        path: input.path,
        contents: input.contents,
        version: outcome.version,
      });
    },
  });
}

/** The catalog generation the host view carries; before it arrives, the one startup read. */
function useCatalogGeneration(): string {
  return useWatch(hostWatch("host"))?.catalog ?? INITIAL_CATALOG;
}

const INITIAL_CATALOG = "initial";

/** Providers, models, and the default model, in one read; read again when the host's catalog generation moves. */
export function useCatalog(_sessionId?: SessionId) {
  const generation = useCatalogGeneration();
  const pending = useMutationState<MutationState<unknown, Error, ModelRef>>({
    filters: { mutationKey: ["catalog", "default"], status: "pending" },
  });

  return useQuery({
    queryKey: keys.catalog(generation),
    queryFn: readCatalog,
    placeholderData: (previous) => previous,
    select: (catalog) => {
      const model = pending.at(-1)?.variables;

      return model === undefined || catalog.defaults === undefined
        ? catalog
        : { ...catalog, defaults: { ...catalog.defaults, model } };
    },
  });
}

/** The raw catalog view, for the provider rows Settings › Models draws. */
export function useModelCatalog() {
  const generation = useCatalogGeneration();

  return useQuery<ModelCatalogView>({
    queryKey: keys.modelCatalog(generation),
    queryFn: () => connection().models.list(),
    placeholderData: (previous) => previous,
  });
}

/**
 * Registered desktop history has no usage watch. Refresh on each visit or
 * manually, not on a timer: the host walks stored commits for every read.
 */
export function usageReportOptions(untilDay: string) {
  return {
    queryKey: keys.usage(untilDay),
    queryFn: () => {
      const usage = nyte.host.usage;

      if (usage === undefined) throw new Error("This host keeps no usage history.");

      return usage({ sinceDay: null, untilDay } satisfies UsageWindow);
    },
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
  } as const;
}

/**
 * A usage read, flattened to what the page actually branches on. A failed
 * refresh keeps the last good report and reports the error alongside it.
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

/** Provider-reported account windows, as the catalog's providers carry them. */
export function useAccountLimits() {
  const catalog = useModelCatalog();

  return {
    ...catalog,
    data: catalog.data?.providers.flatMap((provider) =>
      provider.limits.length === 0
        ? []
        : [{ provider: provider.id, name: provider.name, limits: provider.limits }],
    ),
  };
}

/** What plugins contribute to a session: commands, settings, skills. Empty before a chat exists. */
export function usePluginCatalog(sessionId?: SessionId) {
  const view = useSessionView(sessionId);

  return { data: view?.catalog, isError: false };
}

/** The commands a session's palette offers, as its view carries them. */
export function useSessionCommands(sessionId: SessionId) {
  const view = useSessionView(sessionId);

  return { data: view?.catalog.commands };
}

/** Sets the model a new chat starts with; the picker paints the choice until the host answers. */
export function useSetPreference() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["catalog", "default"],
    scope: { id: "catalog-default" },
    mutationFn: async (model: ModelRef) => {
      const outcome = await connection().models.setDefault(model);

      if (outcome.kind === "unknown-model") throw new Error("That model is no longer available");
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["catalog"] }),
    onError: () =>
      toast.add({ type: "error", title: "Couldn't save model preferences. Try again." }),
  });
}

let localLoadVersion = 0;

/**
 * The host has changed folders: the stage rebinds to that folder's panes now,
 * before the caches behind it refill.
 */
export function commitHostWorkspace(workspace: SelectedWorkspace | undefined): void {
  queryClient.setQueryData<HostState>(keys.host, (host) =>
    host === undefined ? host : { ...host, workspace },
  );
}

let connecting: Promise<unknown> | Connection | undefined;

/**
 * Connect once, then refill workspace caches after a host transition,
 * committing host state last.
 */
export async function loadLocalResources(): Promise<void> {
  const version = ++localLoadVersion;

  connecting ??=
    currentConnection() ??
    nyte.host
      .endpoint()
      .then((endpoint) => connectHost(endpoint, { remember: nyte.host.remember }))
      .catch((cause: unknown) => {
        connecting = undefined;
        throw cause;
      });
  await connecting;

  const [host, workspaces, catalog] = await Promise.all([
    readHost(),
    readWorkspaces(),
    readCatalog(),
  ]);

  if (version !== localLoadVersion) return;

  const workspaceScopes = new Set(["git", "files", "github", "customize"]);
  queryClient.removeQueries({
    predicate: (query) => workspaceScopes.has(String(query.queryKey[0])),
  });
  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.catalog(INITIAL_CATALOG), catalog);

  if (directoryWatch("all").value === undefined) await directoryWatch("all").next();
  queryClient.setQueryData(keys.host, host);
}

/** Share pending configuration with the draft-to-session handoff. */
export function configureSession(sessionId: SessionId, patch: ConfigureSessionPatch) {
  return queryClient
    .getMutationCache()
    .build(queryClient, sessionConfigurationOptions({ sessionId }))
    .execute(patch);
}

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(sessionConfigurationOptions({ sessionId }));
}

interface ApplyPluginSettingInput {
  readonly id: string;
  readonly value: Json;
}

/** Paints pending setting values over the ones a view carries. */
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
            setting.id === input.id ? { ...setting, value: input.value } : setting,
          );
    }, settings);
}

/** Writes one setting: a session setting through `configure`, a host setting through `settings.apply`. */
export function useApplyPluginSetting(sessionId: SessionId | undefined) {
  return useMutation({
    mutationKey: ["plugins", "apply", sessionId],
    networkMode: "always",
    mutationFn: async ({ id, value }: ApplyPluginSettingInput) => {
      if (sessionId === undefined) {
        const outcome = await connection().settings.apply(id, value);

        if (outcome.kind === "unknown") throw new Error("That setting is no longer available");

        if (outcome.kind === "invalid") throw new Error("That setting value is not valid");

        return;
      }

      const outcome = await connection()
        .session(sessionId)
        .configure({ settings: { [id]: value } });

      if (outcome.kind === "invalid") throw new Error("That setting value is not valid");

      if (outcome.kind !== "configured") throw new Error("That setting is no longer available");
    },
    onError: () =>
      toast.add({
        type: "error",
        title: "Couldn't change that setting. Try again.",
        id: "plugin-setting-error",
      }),
  });
}

export function useRenameSession() {
  const actions = useSessionActions();

  return useMutation({
    mutationFn: (input: { sessionId: SessionId; name: string }) => actions.rename(input),
  });
}
