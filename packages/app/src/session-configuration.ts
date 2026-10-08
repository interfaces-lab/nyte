import { mutationOptions } from "@tanstack/react-query";
import type { MutationState, QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import type { SessionsBridge } from "./bridge.ts";
import { keys } from "./query-keys.ts";

export type ConfigureSessionPatch = Pick<
  Parameters<SessionsBridge["configure"]>[0],
  "model" | "thinkingLevel"
>;

/** One sequence for every configure request in the app, so order survives any observer. */
let nextConfigureStamp = 0;

/** A request's own record: its place in that sequence. */
interface ConfigureRequest {
  readonly stamp: number;
}

export type PendingConfiguration = MutationState<
  void,
  Error,
  ConfigureSessionPatch,
  ConfigureRequest
>;

export interface SessionSelection {
  /** Resolves once a read that started after core's reply has landed in the cache; rejects when that read fails. */
  acknowledge(): Promise<void>;
}

/** The newest stamp whose acknowledged read the cache holds; nothing yet when the entry is gone. */
export function acknowledgedThrough(client: QueryClient, sessionId: SessionId): number {
  return client.getQueryData<number>(keys.sessionAcknowledged(sessionId)) ?? 0;
}

/**
 * A choice paints from the moment it is made until its acknowledged read lands,
 * newest last. Core admits requests in call order and answers after admitting,
 * so a request stamped before one that has since been acknowledged is already
 * in that acknowledgement's read and stops painting.
 */
export function projectSessionConfiguration(
  session: SessionInfo,
  pending: readonly PendingConfiguration[],
  acknowledged: number,
): SessionInfo {
  return pending
    .filter((mutation) => (mutation.context?.stamp ?? Infinity) > acknowledged)
    .reduce(
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
    // Desktop IPC never waits for the network; a paused mutation would leave a
    // choice painted but unsent while the outbox still sends.
    networkMode: "always",
    onMutate: (): ConfigureRequest => ({ stamp: ++nextConfigureStamp }),
    mutationFn: async (patch: ConfigureSessionPatch) => {
      const outcome = await sessions.configure({ sessionId, ...patch });

      if (outcome.kind !== "queued") throw new Error("That model setting is no longer available");
    },
    // The request stays pending, so its choice keeps painting, until a read made
    // after core's reply is in the cache. Nothing replays the patch.
    onSuccess: async (_outcome, _patch, request) => {
      await client.cancelQueries({ queryKey: keys.snapshot(sessionId), exact: true });
      await selection.acknowledge();
      client.setQueryData<number>(keys.sessionAcknowledged(sessionId), (through) =>
        Math.max(through ?? 0, request.stamp),
      );
    },
  });
}
