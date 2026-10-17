import {
  QueryClient,
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { asId, ModelRefType } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import { toast } from "@nyte-ai/ui/toast";
import type {
  ChangeSet,
  CommandInfo,
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
  SearchInput,
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
import type { PendingConfiguration } from "./session-configuration.ts";
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
  connected,
  currentConnection,
  directoryWatch,
  gitStatusWatch,
  hostWatch,
  jobsWatch,
  sessionWatch,
  useWatch,
  useWatchSelect,
} from "./sdk.tsx";
import { USAGE_STALE_AFTER_MS } from "./chrome/usage-view.ts";
import { toDesktopCatalog } from "./catalog.ts";
import { workspaceName, workspacePath } from "./view-helpers.ts";
import { mentionFile } from "./conversation/message-references.ts";
import { subagentActivity } from "./conversation/subagent-status.ts";
import type { MentionFile } from "./conversation/message-references.ts";
import type { DesktopCatalog } from "./catalog.ts";
import { startupReadsReleased } from "./startup.ts";

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

const readWorkspaces = async () => (await connected()).workspaces.list();

const readModelCatalog = async () => (await connected()).models.list();

function newestCatalogQuery() {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ["catalog", "models"] })
    .filter((query) => query.state.data !== undefined)
    .toSorted((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
    .at(0);
}

/** The newest catalog any generation answered: a live one, or the last run's seed until one does. */
export function newestModelCatalog(): ModelCatalogView | undefined {
  const newest = newestCatalogQuery();

  return newest === undefined
    ? undefined
    : queryClient.getQueryData<ModelCatalogView>(newest.queryKey);
}

function cachedModelCatalog(previous: ModelCatalogView | undefined): ModelCatalogView | undefined {
  return previous ?? newestModelCatalog();
}

const DEFAULT_MODEL_MUTATION = ["catalog", "default"] as const;

/**
 * The catalog a new chat's start checks its model against, once the host
 * answers: the newest live answer, or a fresh read when only the last run's
 * seed is cached. A pick still being saved outranks the host's default.
 */
export async function readStartCatalog(): Promise<DesktopCatalog> {
  const newest = newestCatalogQuery();

  const live =
    newest !== undefined && newest.state.dataUpdatedAt > 0
      ? queryClient.getQueryData<ModelCatalogView>(newest.queryKey)
      : undefined;

  const catalog = toDesktopCatalog(live ?? (await readModelCatalog()));

  const picked = queryClient
    .getMutationCache()
    .findAll({ mutationKey: DEFAULT_MODEL_MUTATION, status: "pending" })
    .at(-1)?.state.variables;

  return Value.Check(ModelRefType, picked)
    ? { ...catalog, defaults: { model: picked, thinkingLevel: undefined } }
    : catalog;
}

export function selectedWorkspaceId(): WorkspaceId | undefined {
  return queryClient.getQueryData<HostState>(keys.host)?.workspace?.id;
}

/** The folder a chat lives in: null for Home, undefined until the directory and folders load. */
export function sessionFolderPath(sessionId: SessionId): string | null | undefined {
  const session = directoryWatch("all").value?.find((candidate) => candidate.id === sessionId);
  const workspaces = queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces);

  if (session === undefined || workspaces === undefined) return undefined;
  const workspace = workspaces.find((candidate) => candidate.id === session.workspace);

  return workspace === undefined || workspace.availability.kind === "unavailable"
    ? null
    : workspacePath(workspace);
}

export async function workspaceFiles(): Promise<FilesApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its files");
  const capability = await (await connected()).workspace(id).files();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

export async function workspaceGit(): Promise<GitApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its repository");
  const capability = await (await connected()).workspace(id).git();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

export const readSession = async (sessionId: SessionId) =>
  (await connected()).session(sessionId).info();

/**
 * A window opens on Home, so its host state is known before the host answers.
 * It never fetches on its own: `loadLocalResources` and workspace events write it.
 */
const OPENING_HOST_STATE: HostState = { workspace: undefined };

export function useHostState() {
  const { data } = useQuery({
    queryKey: keys.host,
    queryFn: skipToken,
    initialData: OPENING_HOST_STATE,
  });

  return { data: data ?? OPENING_HOST_STATE };
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

export interface RailWorkspace extends SelectedWorkspace {
  readonly available: boolean;
  /** The folder this worktree was made from and its branch; null for a folder the user added. */
  readonly worktree: { readonly source: WorkspaceId; readonly branch: string } | null;
}

export function useWorkspaces() {
  const pending = useMutationState<MutationState<void, Error, WorkspaceId>>({
    filters: { mutationKey: ["workspace", "forget"], status: "pending" },
  });

  return useQuery({
    queryKey: keys.workspaces,
    queryFn: readWorkspaces,
    placeholderData: () =>
      queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.firstFrameWorkspaces),
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
                worktree:
                  workspace.isolation === null
                    ? null
                    : { source: workspace.isolation.source, branch: workspace.isolation.branch },
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
      const outcome = await (await connected()).workspaces.forget(id);

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

/** The live directory's roots; until it arrives, the ones the last run recorded. */
function useRootSessions(): readonly SessionInfo[] | undefined {
  const projection = useSessionProjection();
  const all = useWatch(directoryWatch("all")).value;

  const recorded = useQuery<readonly SessionInfo[]>({
    queryKey: keys.firstFrameRoots,
    queryFn: skipToken,
  }).data;

  return useMemo(() => {
    if (all !== undefined) return projection.list(all.filter((session) => session.parent === null));

    return recorded === undefined ? undefined : projection.list(recorded);
  }, [all, projection, recorded]);
}

const NO_SESSIONS: ReadonlySet<SessionId> = new Set();

export function useWorkingSessionIds(): ReadonlySet<SessionId> {
  const all = useWatch(directoryWatch("all")).value;

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

/** A chat's info: its session directory row, or a host read once the directory has answered without it. */
export function useSession(sessionId: SessionId | undefined) {
  const projection = useSessionProjection();
  const directory = useWatch(directoryWatch("all"));
  const listed = directory.value?.find((session) => session.id === sessionId);

  const read = useQuery({
    queryKey: keys.session(sessionId ?? asId<"session">("")),
    queryFn: () => (sessionId === undefined ? null : readSession(sessionId).catch(missingAsNull)),
    enabled:
      (directory.value !== undefined || directory.error !== undefined) &&
      listed === undefined &&
      sessionId !== undefined,
  });

  const row = listed ?? read.data;

  return {
    ...read,
    data: row === undefined || row === null ? row : projection.session(row),
  };
}

/** The session's live view with the watch's failure and a retry. */
export function useSessionState(sessionId: SessionId | undefined) {
  return useWatch(sessionId === undefined ? undefined : sessionWatch(sessionId));
}

export function useSessionView(sessionId: SessionId | undefined): SessionView | undefined {
  return useSessionState(sessionId).value;
}

/** What a running session is doing now, in words; re-renders only when the words change. */
export function useSessionActivity(
  sessionId: SessionId | undefined,
  cwd: string | undefined,
): string | undefined {
  return useWatchSelect(sessionId === undefined ? undefined : sessionWatch(sessionId), (state) =>
    subagentActivity(state.value, cwd),
  );
}

export function useSessionChoice(sessionId: SessionId) {
  const configuration = useWatchSelect(
    sessionWatch(sessionId),
    (state) => state.value?.configuration,
  );

  const pending = useMutationState<PendingConfiguration>({
    filters: { mutationKey: ["session", sessionId, "configure"], status: "pending" },
  });

  return configuration === undefined ? undefined : projectSessionChoice({ configuration }, pending);
}

export function useChildSessions(sessionId: SessionId | undefined) {
  const children = useWatch(sessionId === undefined ? undefined : childrenWatch(sessionId)).value;

  return { data: children };
}

export function useWorkspaceJobs(workspace: WorkspaceId | undefined) {
  return useWatch(workspace === undefined ? undefined : jobsWatch(workspace)).value;
}

export function useVcsChanges(
  scope: GitScope | undefined,
  ignoreWhitespace: boolean,
  revision: string | undefined,
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

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

export function useVcsLog(
  input: { readonly limit: number; readonly cursor?: Cursor | undefined },
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

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

export function useRunChanges(input: {
  readonly workspace: WorkspaceId | undefined;
  readonly runId: RunId | undefined;
  readonly live: boolean;
  readonly enabled?: boolean;
}) {
  const { workspace, runId, live, enabled = true } = input;

  return useQuery<ChangeSet>({
    queryKey: keys.runChanges(workspace, runId, live),
    queryFn: async () => {
      if (workspace === undefined || runId === undefined) throw new Error("No run to compare");

      return (await connected()).workspace(workspace).changes(runId);
    },
    enabled: enabled && workspace !== undefined && runId !== undefined,
    staleTime: live ? 0 : "static",
  });
}

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

export async function readGitPatches(
  scope: GitScope,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  return firstPatches((await workspaceGit()).patches(scope, paths, { ignoreWhitespace }), paths);
}

export async function readRunPatches(
  workspace: WorkspaceId,
  run: RunId,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  const current = await connected();

  return firstPatches(
    current.workspace(workspace).patches(run, paths, { ignoreWhitespace }),
    paths,
  );
}

async function scanFiles(): Promise<readonly MentionFile[]> {
  await startupReadsReleased();
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

/**
 * Rereads the repository and the files under it: the git status watch reopens,
 * which makes the host read status afresh, and every git query (changes, log,
 * refs, run changes), the file list and open file documents refetch. Resolves
 * once the active queries have refetched.
 */
export async function refreshVcs(): Promise<void> {
  const workspace = selectedWorkspaceId();

  if (workspace !== undefined) gitStatusWatch(workspace).retry();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["git"] }),
    queryClient.invalidateQueries({ queryKey: keys.mentionFiles, exact: true }),
    queryClient.invalidateQueries({ queryKey: ["files", "document"] }),
  ]);
}

export function useVcsSnapshot(enabled: boolean) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  return {
    data: useWatch(enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined)
      .value,
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

async function searchWorkspace(input: SearchInput) {
  const matches: Extract<SearchFrame, { readonly kind: "match" }>[] = [];
  let truncated = false;

  for await (const frame of (await workspaceFiles()).search(input)) {
    if (frame.kind === "match") matches.push(frame);

    if (frame.kind === "truncated") truncated = true;
  }

  return { matches, truncated };
}

export function useWorkspaceSearch(input: SearchInput | undefined, enabled = true) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  return useQuery({
    queryKey: keys.workspaceSearch(workspace ?? "", input),
    queryFn: () => {
      if (input === undefined) throw new Error("Type to search");

      return searchWorkspace(input);
    },
    enabled: enabled && workspace !== undefined && input !== undefined && input.query.length > 0,
    retry: false,
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

/** The SDK's link to the host: connected, reconnecting after a loss, or closed for good. */
export function useHostLink() {
  return useWatchSelect(hostWatch("host"), (state) => state.value?.link);
}

function useCatalogGeneration(): string {
  return useWatchSelect(hostWatch("host"), (state) => state.value?.catalog) ?? "initial";
}

export function useCatalog(_sessionId?: SessionId) {
  const generation = useCatalogGeneration();

  const pending = useMutationState<MutationState<unknown, Error, ModelRef>>({
    filters: { mutationKey: DEFAULT_MODEL_MUTATION, status: "pending" },
  });

  return useQuery({
    queryKey: keys.modelCatalog(generation),
    queryFn: readModelCatalog,
    placeholderData: cachedModelCatalog,
    select: (view): DesktopCatalog => {
      const catalog = toDesktopCatalog(view);
      const model = pending.at(-1)?.variables;

      return model === undefined || catalog.defaults === undefined
        ? catalog
        : { ...catalog, defaults: { ...catalog.defaults, model } };
    },
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

function accountLimitsOptions(generation: string) {
  return {
    queryKey: keys.accountLimits(generation),
    queryFn: async () => (await connected()).models.usage(),
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
  } as const;
}

export function useAccountLimits() {
  return useQuery(accountLimitsOptions(useCatalogGeneration()));
}

export const COMPACT_COMMAND = {
  name: "compact",
  owner: "",
  side: "client",
  title: "Compact",
  description: "Summarize the chat to free up context",
  arguments: null,
} satisfies CommandInfo;

export function usePluginCatalog(sessionId?: SessionId) {
  const store = sessionId === undefined ? undefined : sessionWatch(sessionId);
  const catalog = useWatchSelect(store, (state) => state.value?.catalog);

  const failed = useWatchSelect(
    store,
    (state) => state.value === undefined && state.error !== undefined,
  );

  const data = useMemo(
    () =>
      catalog === undefined
        ? undefined
        : { ...catalog, commands: [...catalog.commands, COMPACT_COMMAND] },
    [catalog],
  );

  return { data, isError: failed };
}

export function useSetPreference() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: DEFAULT_MODEL_MUTATION,
    scope: { id: "catalog-default" },
    mutationFn: async (model: ModelRef) => {
      const outcome = await (await connected()).models.setDefault(model);

      if (outcome.kind === "unknown-model") throw new Error("That model is no longer available");
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["catalog"] }),
    onError: () =>
      toast.add({ type: "error", title: "Couldn't save model preferences. Try again." }),
  });
}

let localLoadVersion = 0;

export function commitHostWorkspace(workspace: SelectedWorkspace | undefined): void {
  queryClient.setQueryData<HostState>(keys.host, (host) => ({ ...host, workspace }));
}

let connecting: Promise<Connection> | undefined;

/**
 * Connect to this window's host once. A failed attempt is forgotten, so the
 * next call tries again.
 */
export function connectLocalHost(): Promise<Connection> {
  const current = currentConnection();

  if (current !== undefined) return Promise.resolve(current);

  connecting ??= nyte.host
    .endpoint()
    .then((endpoint) => connectHost(endpoint, { remember: nyte.host.remember }))
    .then((opened) => {
      performance.mark("nyte:sdk-connected");

      return opened;
    })
    .catch((cause: unknown) => {
      connecting = undefined;
      throw cause;
    });

  return connecting;
}

/**
 * Refill the workspace caches after a host transition. Every read waits for
 * the connection on its own and runs alongside the others. The workspace
 * queries are reset after the host state is committed, not removed: a removed
 * query cancels its fetch silently and strands the components still
 * observing it on a pending result, while a reset one refetches for its
 * mounted observers against the new workspace.
 */
export async function loadLocalResources(): Promise<void> {
  const version = ++localLoadVersion;
  const host = hostWatch("host");
  const directory = directoryWatch("all");

  const [state, workspaces, catalog] = await Promise.all([
    readHost(),
    readWorkspaces(),
    readModelCatalog(),
    host.value === undefined ? host.next() : undefined,
    directory.value === undefined
      ? directory.next().then(() => performance.mark("nyte:directory-ready"))
      : undefined,
  ]);

  if (version !== localLoadVersion) return;
  const workspaceScopes = new Set(["git", "files", "github", "customize"]);
  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.modelCatalog(catalog.generation), catalog);
  queryClient.setQueryData(keys.host, state);
  void queryClient.resetQueries({
    predicate: (query) => workspaceScopes.has(String(query.queryKey[0])),
  });
}

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(sessionConfigurationOptions({ sessionId }));
}

interface ApplyPluginSettingInput {
  readonly id: string;
  readonly value: Json;
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
            setting.id === input.id ? { ...setting, value: input.value } : setting,
          );
    }, settings);
}

export function useApplyPluginSetting(sessionId: SessionId | undefined) {
  return useMutation({
    mutationKey: ["plugins", "apply", sessionId],
    networkMode: "always",
    mutationFn: async ({ id, value }: ApplyPluginSettingInput) => {
      if (sessionId === undefined) {
        const outcome = await (await connected()).settings.apply(id, value);

        if (outcome.kind === "unknown") throw new Error("That setting is no longer available");

        if (outcome.kind === "invalid") throw new Error("That setting value is not valid");

        return;
      }

      const outcome = await (
        await connected()
      )
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
