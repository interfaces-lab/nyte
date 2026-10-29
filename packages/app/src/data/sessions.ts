import { useMutation, useMutationState } from "@tanstack/react-query";
import type { SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { projectSessionChoice, sessionConfigurationOptions } from "./session-configuration.ts";
import type { PendingConfiguration } from "./session-configuration.ts";
import { groupByWorkspace } from "./session-list.ts";
import { useRootRows, useSessionRow } from "./session-rows.ts";
import { childrenWatch, sessionWatch } from "./watches.ts";
import { useWatch, useWatchSelect } from "./watch-store.ts";
import { subagentActivity } from "./session-activity.ts";
import { useSessionActions } from "./session-actions.ts";
import { useWorkspaces } from "./workspaces.ts";

export function useWorkspaceSessions() {
  const roots = useRootRows();
  const workspaces = useWorkspaces().data;

  return {
    data: roots === undefined ? undefined : groupByWorkspace(roots, workspaces ?? []),
  };
}

export function useSessionSearch(search: string, enabled = true) {
  const roots = useRootRows();
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

const WHOLE = (session: SessionInfo): SessionInfo => session;

/** `data` is `undefined` while loading and `null` for a missing session. With `select`, only a change to the selected value re-renders. */
export function useSession(id: SessionId | undefined): {
  readonly data: SessionInfo | null | undefined;
};
export function useSession<S>(
  id: SessionId | undefined,
  select: (session: SessionInfo) => S,
): { readonly data: S | null | undefined };
export function useSession<S>(
  id: SessionId | undefined,
  select?: (session: SessionInfo) => S,
): { readonly data: S | SessionInfo | null | undefined } {
  return { data: useSessionRow<S | SessionInfo>(id, select ?? WHOLE) };
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
