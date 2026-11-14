import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { ClientConnection, SessionsSnapshot, SessionsWindow } from "@nyte-ai/sdk/client";
import { watchFamily } from "./watch-store.ts";
import type { LiveView, Shown } from "./watch-store.ts";

/** `pinned` is every pinned root however old, which the sidebar lays over the newest roots; `roots` and `all` are the newest of each. */
export const sessionList = watchFamily(
  (connection, list: "roots" | "all" | "pinned"): LiveView<readonly SessionInfo[]> =>
    directoryRows(
      connection,
      list === "pinned"
        ? { parents: { kind: "roots" }, pinned: true, limit: Number.MAX_SAFE_INTEGER }
        : { parents: { kind: list } },
    ),
);

export const childList = watchFamily(
  (connection, parent: SessionId): LiveView<readonly SessionInfo[]> =>
    directoryRows(connection, { parents: { kind: "children", session: parent } }),
);

/** The newest roots whose name holds `query`, ignoring case, answered by the host from its index whatever the number of chats. */
export const sessionSearch = watchFamily(
  (connection, query: string): LiveView<readonly SessionInfo[]> =>
    directoryRows(connection, { parents: { kind: "roots" }, query }),
);

/** The window's rows, read again only when the store's snapshot changes: the SDK keeps a snapshot while its ids and rows stay the same. */
function directoryRows(
  connection: ClientConnection,
  window: SessionsWindow,
): LiveView<readonly SessionInfo[]> {
  const store = connection.sessions.open(window);
  let drawn: SessionsSnapshot | null = null;

  return {
    subscribe: (listener) => store.subscribe(listener),
    show(previous) {
      const snapshot = store.snapshot();

      if (snapshot === drawn && previous !== undefined) return { kind: "shown", value: previous };
      drawn = snapshot;

      return showSessions(snapshot);
    },
    close: () => store.close(),
  };
}

/** The window's rows in its order, skipping an id without a row. */
export function showSessions(snapshot: SessionsSnapshot | null): Shown<readonly SessionInfo[]> {
  if (snapshot === null) return { kind: "waiting" };

  return {
    kind: "shown",
    value: snapshot.ids.flatMap((id) => {
      const info = snapshot.rows.get(id);

      return info === undefined ? [] : [info];
    }),
  };
}
