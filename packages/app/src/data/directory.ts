import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { HostConnection, SessionsWindow } from "@nyte-ai/sdk/client";
import { liveFamily, liveValues } from "./watch-store.ts";

export const sessionList = liveFamily(
  (live, parents: "roots" | "all"): AsyncIterable<readonly SessionInfo[]> =>
    directoryRows(live, { parents: { kind: parents } }),
);

/** One session's children as the host lists them: their rows without the capped list of every session. */
export const childList = liveFamily(
  (live, parent: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    directoryRows(live, { parents: { kind: "children", session: parent } }),
);

function directoryRows(
  live: HostConnection,
  window: SessionsWindow,
): AsyncIterable<readonly SessionInfo[]> {
  return liveValues((changed) => {
    const store = live.directory(window);
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
