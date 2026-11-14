import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { ClientConnection, SessionsWindow } from "@nyte-ai/sdk/client";
import { liveValues, watchFamily } from "./watch-store.ts";

/** `pinned` is every pinned root however old, which the sidebar lays over the newest roots; `roots` and `all` are the newest of each. */
export const sessionList = watchFamily(
  (connection, list: "roots" | "all" | "pinned"): AsyncIterable<readonly SessionInfo[]> =>
    directoryRows(
      connection,
      list === "pinned"
        ? { parents: { kind: "roots" }, pinned: true, limit: Number.MAX_SAFE_INTEGER }
        : { parents: { kind: list } },
    ),
);

export const childList = watchFamily(
  (connection, parent: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    directoryRows(connection, { parents: { kind: "children", session: parent } }),
);

/** The newest roots whose name holds `query`, ignoring case, answered by the host from its index whatever the number of chats. */
export const sessionSearch = watchFamily(
  (connection, query: string): AsyncIterable<readonly SessionInfo[]> =>
    directoryRows(connection, { parents: { kind: "roots" }, query }),
);

function directoryRows(
  connection: ClientConnection,
  window: SessionsWindow,
): AsyncIterable<readonly SessionInfo[]> {
  return liveValues((changed) => {
    const store = connection.sessions.open(window);
    const stop = store.subscribe(changed);
    let shown: {
      readonly ids: readonly SessionId[];
      readonly rows: readonly SessionInfo[];
    } | null = null;
    let held: ReadonlyMap<string, SessionInfo> | null = null;

    return {
      read() {
        const snapshot = store.snapshot();

        if (snapshot === null) return null;

        if (shown?.ids === snapshot.ids && held === snapshot.rows) return shown.rows;
        held = snapshot.rows;

        const rows = snapshot.ids.flatMap((id) => {
          const info = snapshot.rows.get(id);

          return info === undefined ? [] : [info];
        });

        const kept =
          shown !== null &&
          shown.rows.length === rows.length &&
          shown.rows.every((row, index) => row === rows[index])
            ? shown.rows
            : rows;

        shown = { ids: snapshot.ids, rows: kept };

        return kept;
      },
      close() {
        stop();
        store.close();
      },
    };
  });
}
