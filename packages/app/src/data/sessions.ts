import { SdkError } from "@nyte-ai/sdk";
import { skipToken, useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { asId } from "@nyte-ai/schema";
import type { SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { keys } from "./query-client.ts";
import { projectSessionChoice, sessionConfigurationOptions } from "./session-configuration.ts";
import type { PendingConfiguration } from "./session-configuration.ts";
import { groupByWorkspace } from "./session-list.ts";
import { childrenWatch, sessionsWatch, sessionWatch } from "./watches.ts";
import { connected } from "./connection.ts";
import { useWatch, useWatchSelect } from "./watch-store.ts";
import type { WatchState } from "./watch-store.ts";
import { subagentActivity } from "./session-activity.ts";
import { useSessionActions, useSessionProjection } from "./session-actions.ts";
import { useWorkspaces } from "./workspaces.ts";

export const readSession = async (sessionId: SessionId) =>
  (await connected()).session(sessionId).info();

/** One session's own read, for a session the lists don't carry; a missing one reads as null. */
export function sessionQuery(sessionId: SessionId) {
  return {
    queryKey: keys.session(sessionId),
    queryFn: () => readSession(sessionId).catch(missingAsNull),
  };
}

function useRootSessions(): readonly SessionInfo[] | undefined {
  const projection = useSessionProjection();
  const roots = useWatch(sessionsWatch("roots")).value;

  const recorded = useQuery<readonly SessionInfo[]>({
    queryKey: keys.firstFrameRoots,
    queryFn: skipToken,
  }).data;

  const listed = roots ?? recorded;

  return listed === undefined ? undefined : projection.list(listed);
}

export function useWorkspaceSessions() {
  const roots = useRootSessions();
  const workspaces = useWorkspaces().data;

  return {
    data: roots === undefined ? undefined : groupByWorkspace(roots, workspaces ?? []),
  };
}

export function useSessionSearch(search: string, enabled = true) {
  const roots = useRootSessions();
  const needle = search.trim().toLocaleLowerCase();

  return {
    data:
      !enabled || needle === "" || roots === undefined
        ? undefined
        : {
            items: roots.filter(
              (session) =>
                !session.archived && (session.name ?? "").toLocaleLowerCase().includes(needle),
            ),
          },
  };
}

const UNLISTED = Symbol("unlisted");

type SessionRead<S> = Omit<UseQueryResult, "data"> & { readonly data: S | null | undefined };

type SelectSession<S> = (session: SessionInfo) => S;

/** `data` is `undefined` while loading and `null` for a missing session. With `select`, only a change to the selected value re-renders. */
export function useSession(id: SessionId | undefined): SessionRead<SessionInfo>;
export function useSession<S>(id: SessionId | undefined, select: SelectSession<S>): SessionRead<S>;
export function useSession<S>(
  id: SessionId | undefined,
  select?: SelectSession<S>,
): SessionRead<S | SessionInfo> {
  const projection = useSessionProjection();

  const pick = (session: SessionInfo) => {
    const projected = projection.session(session);

    return projected === null || select === undefined ? projected : select(projected);
  };

  const list = ({ value }: WatchState<readonly SessionInfo[]>) => {
    const session = value?.find((candidate) => candidate.id === id);

    return session === undefined ? UNLISTED : pick(session);
  };

  const roots = sessionsWatch("roots");
  const root = useWatchSelect(roots, list);
  const row = useWatchSelect(sessionsWatch("all"), (all) => (root === UNLISTED ? list(all) : root));
  const settled = useWatchSelect(roots, (state) => (state.value ?? state.error) !== undefined);

  const read = useQuery({
    ...sessionQuery(id ?? asId<"session">("")),
    enabled: settled && row === UNLISTED && id !== undefined,
    select: (session: SessionInfo | null) => (session === null ? null : pick(session)),
  });

  return { ...read, data: row === UNLISTED ? read.data : row };
}

export function useSessionView(sessionId: SessionId | undefined): SessionView | undefined {
  return useWatch(sessionId === undefined ? undefined : sessionWatch(sessionId)).value;
}

export function useSessionActivity(
  sessionId: SessionId | undefined,
  cwd: string | undefined,
): string | undefined {
  return useWatchSelect(sessionId === undefined ? undefined : sessionWatch(sessionId), (state) =>
    subagentActivity(state.value?.activity, cwd),
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

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(sessionConfigurationOptions({ sessionId }));
}

export function useRenameSession() {
  const actions = useSessionActions();

  return useMutation({
    mutationFn: (input: { sessionId: SessionId; name: string }) => actions.rename(input),
  });
}

export function missingAsNull(cause: unknown): null {
  if (cause instanceof SdkError && cause.code === "unknown") return null;
  throw cause;
}
