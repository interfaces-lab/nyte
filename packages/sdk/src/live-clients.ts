import { ClientRowType, compile, withJson } from "@nyte-ai/schema";
import type { ClientRow } from "@nyte-ai/schema";
import { keepRows, listenerSet } from "./live.ts";
import type { Join, Live } from "./live.ts";

export interface ClientsStore extends Live<ReadonlyMap<string, ClientRow>> {
  close(): void;
}

const clientRows = compile(withJson(ClientRowType));

export function openClientsStore(join: Join): ClientsStore {
  const listeners = listenerSet();
  let snapshot: ReadonlyMap<string, ClientRow> = new Map();
  let stop: (() => void) | null = null;

  const leave = join("host", {
    attach(live, subscribe) {
      stop = live.onEvent((event) => {
        if (event.scope !== "host" || event.kind !== "live" || !Array.isArray(event.clients))
          return;
        const rows = event.clients.filter((row) => clientRows.Check(row));
        const next = keepRows(new Map(rows.map((row) => [row.id, row])), snapshot);

        if (next === snapshot) return;
        snapshot = next;
        listeners.notify();
      });
      void subscribe();
    },
    detach() {
      stop?.();
      stop = null;
    },
  });

  return {
    subscribe: listeners.subscribe,
    snapshot: () => snapshot,
    close() {
      leave();
      listeners.clear();
    },
  };
}
