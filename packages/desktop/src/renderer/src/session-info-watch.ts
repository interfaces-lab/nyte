import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import type { NyteBridge } from "../../shared/ipc.ts";

export function watchSessionInfo({
  client,
  sessionId,
  onUpdate,
}: {
  readonly client: Pick<NyteBridge, "sessions" | "watch">;
  readonly sessionId: SessionId;
  readonly onUpdate: (session: SessionInfo | undefined) => void;
}): () => void {
  let disposed = false;
  let dirty = false;
  let reading = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const scheduleRead = (delay = 0): void => {
    if (disposed) return;
    dirty = true;

    if (refreshTimer !== undefined || reading) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void read();
    }, delay);
  };

  const read = async (): Promise<void> => {
    if (disposed) return;
    reading = true;
    dirty = false;
    let retry = 0;

    try {
      const session = await client.sessions.get({ sessionId });

      if (!disposed && !dirty) onUpdate(session);
    } catch {
      dirty = true;
      retry = 1_000;
    } finally {
      reading = false;

      if (dirty) scheduleRead(retry);
    }
  };

  const reconnect = (): void => {
    if (disposed || reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, 1_000);
  };

  const connect = (): void => {
    if (disposed) return;
    unsubscribe?.();

    try {
      unsubscribe = client.watch(
        { sessionId, live: true },
        (event) => {
          if (
            event.kind === "synced" ||
            event.kind === "activation_changed" ||
            event.kind === "run" ||
            event.kind === "effect" ||
            event.kind === "head_moved" ||
            event.kind === "stack" ||
            event.kind === "fact" ||
            event.kind === "config_queued" ||
            event.kind === "queued" ||
            event.kind === "landed" ||
            event.kind === "queue_cancelled" ||
            event.kind === "deleted"
          ) {
            scheduleRead();
          }
        },
        reconnect,
      );
    } catch {
      reconnect();
    }
  };

  connect();

  return () => {
    disposed = true;
    clearTimeout(refreshTimer);
    clearTimeout(reconnectTimer);
    unsubscribe?.();
  };
}
