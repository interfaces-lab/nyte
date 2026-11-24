import type { Connection } from "@nyte-ai/sdk";
import type { Live, LinkState } from "@nyte-ai/sdk/client";
import { keys, queryClient } from "./query-client.ts";
import { nyte } from "../contract/nyte.ts";
import { hostWatch } from "./watches.ts";
import { sessionList } from "./directory.ts";
import { connectHost, currentConnection } from "./connection.ts";
import { publishStartupConnection } from "./startup.ts";
import { workspacesQuery } from "./workspaces.ts";
import { readModelCatalog } from "./catalog.ts";

let connecting: Promise<Connection> | undefined;

export function connectLocalHost(): Promise<Connection> {
  const current = currentConnection();

  if (current !== undefined) return Promise.resolve(current);

  connecting ??= nyte.host
    .endpoint()
    .then((endpoint) =>
      connectHost(endpoint, {
        fetch: nyte.host.fetch,
        socket: nyte.host.socket,
        wait: new AbortController().signal,
        away: () => publishStartupConnection({ kind: "unreachable" }),
      }),
    )
    .then((opened) => {
      performance.mark("nyte:sdk-connected");
      markSocketOpen(opened.link);

      return opened;
    })
    .catch((cause: unknown) => {
      connecting = undefined;
      throw cause;
    });

  return connecting;
}

function markSocketOpen(link: Live<LinkState>): void {
  const check = (): void => {
    if (link.snapshot().kind !== "open") return;
    leave();
    performance.mark("nyte:socket-connected");
  };

  const leave = link.subscribe(check);
  check();
}

export async function loadLocalResources(): Promise<void> {
  const host = hostWatch("host");
  const directory = sessionList("roots");

  const [workspaces, catalog] = await Promise.all([
    workspacesQuery.queryFn(),
    readModelCatalog(),
    host.value === undefined ? host.until(() => true) : undefined,
    directory.value === undefined
      ? directory.until(() => true).then(() => performance.mark("nyte:directory-ready"))
      : undefined,
  ]);

  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.modelCatalog(catalog.generation), catalog);
}
