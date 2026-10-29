import type { Connection } from "@nyte-ai/sdk";
import { keys } from "./query-client.ts";
import { nyte } from "../contract/nyte.ts";
import { sessionsWatch, hostWatch } from "./watches.ts";
import { connectHost, currentConnection } from "./connection.ts";
import { readHost } from "./host.ts";
import { workspacesQuery } from "./workspaces.ts";
import { readModelCatalog } from "./catalog.ts";
import { queryClient } from "./query-client.ts";

let localLoadVersion = 0;

let connecting: Promise<Connection> | undefined;

export function connectLocalHost(): Promise<Connection> {
  const current = currentConnection();

  if (current !== undefined) return Promise.resolve(current);

  connecting ??= nyte.host
    .endpoint()
    .then((endpoint) =>
      connectHost(endpoint, { remember: nyte.host.remember, fetch: nyte.host.fetch }),
    )
    .then((opened) => {
      performance.mark("nyte:sdk-connected");

      return opened;
    })
    .catch((cause: unknown) => {
      connecting = undefined;
      throw cause;
    });

  return connecting;
}

export async function loadLocalResources(): Promise<void> {
  const version = ++localLoadVersion;
  const host = hostWatch("host");
  const directory = sessionsWatch("roots");

  const [state, workspaces, catalog] = await Promise.all([
    readHost(),
    workspacesQuery.queryFn(),
    readModelCatalog(),
    host.value === undefined ? host.next() : undefined,
    directory.value === undefined
      ? directory.next().then(() => performance.mark("nyte:directory-ready"))
      : undefined,
  ]);

  if (version !== localLoadVersion) return;
  const workspaceScopes = new Set(["git", "files", "github", "customize"]);
  queryClient.setQueryData(keys.workspaces, workspaces);
  queryClient.setQueryData(keys.modelCatalog(catalog.generation), catalog);
  queryClient.setQueryData(keys.host, state);
  void queryClient.resetQueries({
    predicate: (query) => workspaceScopes.has(String(query.queryKey[0])),
  });
}
