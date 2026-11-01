import { useMutation, useMutationState } from "@tanstack/react-query";
import type { SessionId, SessionView } from "@nyte-ai/sdk";
import { projectSessionChoice, sessionConfigurationOptions } from "./session-configuration.ts";
import type { PendingConfiguration } from "./session-configuration.ts";
import { groupByWorkspace } from "./session-list.ts";
import { useRootRows } from "./session-rows.ts";
import { sessionWatch } from "./watches.ts";
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

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(sessionConfigurationOptions({ sessionId }));
}

export function useRenameSession() {
  const actions = useSessionActions();

  return useMutation({
    mutationFn: (input: { sessionId: SessionId; name: string }) => actions.rename(input),
  });
}
