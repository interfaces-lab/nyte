import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { ClientConnection, SessionsSnapshot, SessionsWindow } from "@nyte-ai/sdk/client";
import { keepList } from "./keep.ts";
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

function directoryRows(
  connection: ClientConnection,
  window: SessionsWindow,
): LiveView<readonly SessionInfo[]> {
  const store = connection.sessions.open(window);

  return {
    subscribe: (listener) => store.subscribe(listener),
    show: (previous) => showSessions(store.snapshot(), previous),
    close: () => store.close(),
  };
}

/** The window's rows in its order, skipping an id without a row; `previous` itself while they are the same rows. */
export function showSessions(
  snapshot: SessionsSnapshot | null,
  previous: readonly SessionInfo[] | undefined,
): Shown<readonly SessionInfo[]> {
  if (snapshot === null) return { kind: "waiting" };

  const rows = snapshot.ids.flatMap((id) => {
    const info = snapshot.rows.get(id);

    return info === undefined ? [] : [info];
  });

  return { kind: "shown", value: previous === undefined ? rows : keepList(previous, rows) };
}
