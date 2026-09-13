import { mutationOptions } from "@tanstack/react-query";
import type { MutationState, QueryClient } from "@tanstack/react-query";
import { isTerminalPhase } from "@nyte-ai/core/views";
import type { SessionId, SessionInfo, SessionSnapshot } from "@nyte-ai/core";
import type { SessionsBridge } from "../../shared/ipc.ts";
import { keys } from "./query-keys.ts";
import type { SessionPage } from "./session-directory.ts";

export type ConfigureSessionPatch = Pick<
  Parameters<SessionsBridge["configure"]>[0],
  "model" | "thinkingLevel"
>;

export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

/** The observer's view of a local choice: reads begun before either step no longer answer it. */
export interface SessionSelection {
  request(): void;
  /** Resolves once a read made after core's acknowledgement has landed, or at once when nothing observes the session. */
  acknowledge(): Promise<void>;
}

/** Host refreshes must not erase a choice while its write is in flight. */
export function projectSessionConfiguration(
  session: SessionInfo,
  pending: readonly PendingConfiguration[],
): SessionInfo {
  return pending.reduce(
    (current, mutation) => ({
      ...current,
      config: { ...current.config, ...mutation.variables },
    }),
    session,
  );
}

export function sessionConfigurationOptions({
  client,
  sessions,
  sessionId,
  selection,
}: {
  readonly client: QueryClient;
  readonly sessions: Pick<SessionsBridge, "configure">;
  readonly sessionId: SessionId;
  readonly selection: SessionSelection;
}) {
  return mutationOptions({
    mutationKey: ["session", sessionId, "configure"],
    scope: { id: `session-config:${sessionId}` },
    mutationFn: async (patch: ConfigureSessionPatch) => {
      selection.request();
      const outcome = await sessions.configure({ sessionId, ...patch });
      if (outcome.kind !== "queued") throw new Error("That model setting is no longer available");
    },
    onSuccess: async (_outcome, patch) => {
      // Cancel reads begun before acknowledgement; the observer's own read at
      // this version lands before the pending choice is released.
      await client.cancelQueries({ queryKey: keys.snapshot(sessionId), exact: true });
      await selection.acknowledge();
      const update = (session: SessionInfo): SessionInfo => ({
        ...session,
        config: { ...session.config, ...patch },
      });
      client.setQueryData<SessionInfo | null>(keys.session(sessionId), (current) =>
        current == null ? current : update(current),
      );
      // Selected inputs are the session's; the head's effective inputs follow only when no run holds them.
      client.setQueryData<SessionSnapshot>(keys.snapshot(sessionId), (current) =>
        current === undefined
          ? current
          : {
              ...current,
              session: update(current.session),
              config:
                current.run !== undefined && !isTerminalPhase(current.run.phase)
                  ? current.config
                  : { ...current.config, ...patch },
            },
      );
      client.setQueryData<SessionPage>(keys.sessionPreview, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              items: current.items.map((session) =>
                session.sessionId === sessionId ? update(session) : session,
              ),
            },
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.pluginSettings(sessionId) });
    },
  });
}
