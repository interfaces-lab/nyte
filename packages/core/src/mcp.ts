import type { McpChange, McpScope, McpServerConfig, McpView, WorkspaceId } from "@nyte-ai/schema";
import type { Login, PluginStorage } from "./connection.ts";
import { readWorkspace } from "./environment.ts";
import { SdkError } from "./error.ts";
import { forwarded } from "./watch.ts";
import type { Kernel } from "./kernel.ts";
import { projectTrust } from "./resources.ts";
import type { ToolDefinition } from "./tools.ts";

/**
 * The workspace a hub call is about. Core builds it from the workspace record;
 * a hub reads `root` and `trusted` to decide which `mcp.json` files apply.
 *
 * @category mcp
 * @since 0.1.0
 */
export type McpWorkspace = {
  readonly id: WorkspaceId;
  /** The workspace folder on the host's machine, or `null` when the workspace lives elsewhere: then only user-level servers apply. */
  readonly root: string | null;
  /** True when the user allowed project resources, so the hub may read `<root>/.nyte/mcp.json`. */
  readonly trusted: boolean;
};

/**
 * The host's MCP servers. Implement it once per host and pass its factory as
 * `OpenOptions.mcp`; core then puts the tools in every session (plugin id
 * `mcp`) and serves {@link McpApi} as `workspace(id).mcp` to clients. A host
 * without one answers every `workspace(id).mcp` call with `unavailable`.
 *
 * The hub owns configuration, connections and sign-in; sessions never connect
 * to a server themselves. `watch` opens a workspace's connections and keeps
 * them while any watcher iterates; watchers of the same workspace, root and
 * trust share one set.
 *
 * @example
 * ```ts
 * import { createMcpHub, openHost } from "@nyte-ai/host";
 *
 * const host = await openHost({ ...options, mcp: createMcpHub({ home: homedir() }) });
 * ```
 *
 * @category mcp
 * @since 0.1.0
 */
export interface McpHub {
  /**
   * Yields the workspace's servers at once, then again after any change to a
   * server's state or its `mcp.json`. Iterate it for as long as you need the
   * connections; when the last watcher stops, the hub may close them.
   */
  watch(workspace: McpWorkspace): AsyncIterable<McpView>;

  /**
   * Returns the tools of the workspace's connected servers, named
   * `mcp__<server>__<tool>` with each server's exposure applied, or `[]` when
   * nothing watches the workspace. It is synchronous and never waits for a
   * connection, so call it on every tool derive and reload on each view.
   */
  tools(workspace: McpWorkspace): readonly ToolDefinition[];

  /** See {@link McpApi.reconnect}. */
  reconnect(workspace: McpWorkspace, server: string): Promise<McpChange>;

  /** See {@link McpApi.setEnabled}. */
  setEnabled(workspace: McpWorkspace, server: string, enabled: boolean): Promise<McpChange>;

  /** See {@link McpApi.login}. */
  login(workspace: McpWorkspace, server: string): Login;

  /** See {@link McpApi.logout}. */
  logout(workspace: McpWorkspace, server: string): Promise<McpChange>;

  /** See {@link McpApi.add}. */
  add(
    workspace: McpWorkspace,
    server: string,
    config: McpServerConfig,
    scope: McpScope,
  ): Promise<McpChange>;

  /** See {@link McpApi.remove}. */
  remove(workspace: McpWorkspace, server: string, scope: McpScope): Promise<McpChange>;

  /** Disconnects every server. Core calls it when the host closes. */
  close(): Promise<void>;
}

/**
 * The MCP servers a workspace's sessions use, as `workspace(id).mcp`. Every
 * call needs owner authority and throws `unavailable` on a host without MCP.
 * Actions answer an {@link McpChange}: `missing` when no server has that
 * name, `invalid` with a message when the change cannot be made. Changes to
 * `mcp.json` keep the rest of the file as it was.
 *
 * @example
 * ```ts
 * const mcp = connection.workspace(id).mcp;
 *
 * await mcp.add("docs", { url: "https://docs.example.com/mcp" }, "user");
 *
 * for await (const view of mcp.watch()) {
 *   const docs = view.servers.find((server) => server.name === "docs");
 *
 *   if (docs?.state.kind === "needs-sign-in") {
 *     for await (const step of mcp.login("docs").steps())
 *       if (step.kind === "open") console.log("Open", step.url);
 *   }
 * }
 * ```
 *
 * @category mcp
 * @since 0.1.0
 */
export interface McpApi {
  /**
   * Yields the workspace's servers at once and again whenever a server
   * connects, fails, asks for sign-in, or its `mcp.json` changes. Iterating
   * keeps the workspace's connections open.
   */
  watch(): AsyncIterable<McpView>;

  /** Drops the server's connection and connects again, for one that failed or after fixing its credentials. */
  reconnect(server: string): Promise<McpChange>;

  /**
   * Turns a server on or off by writing `enabled` to the `mcp.json` that
   * defines it, or to the project override of a user server when there is one.
   */
  setEnabled(server: string, enabled: boolean): Promise<McpChange>;

  /**
   * Signs in to a url server with OAuth. Steps: `open` with the authorization
   * page, then `paste` for the redirect URL from the browser's address bar
   * (answer it when the browser cannot reach this machine, such as over SSH;
   * a browser that can finishes on its own), `done` or `failed`. The server
   * reconnects once signed in.
   */
  login(server: string): Login;

  /** Deletes the server's stored OAuth credentials; it asks for sign-in again. */
  logout(server: string): Promise<McpChange>;

  /**
   * Adds or replaces a server in `~/.nyte/mcp.json` (`user`) or the trusted
   * workspace's `.nyte/mcp.json` (`project`). It does not wait for the
   * server to connect; watch for that.
   */
  add(server: string, config: McpServerConfig, scope: McpScope): Promise<McpChange>;

  /** Removes a server from one `mcp.json`; its stored OAuth credentials stay. */
  remove(server: string, scope: McpScope): Promise<McpChange>;
}

/**
 * Builds the host's hub after the kernel exists. Store OAuth tokens in
 * `secrets`: they are sealed with the host's key and shared by every session.
 *
 * @category mcp
 * @since 0.1.0
 */
export type McpHubFactory = (context: { readonly secrets: PluginStorage["secrets"] }) => McpHub;

/**
 * Reads what a hub needs to know about a registered workspace: its local
 * folder and whether its project resources are trusted. Throws `unknown` for
 * a workspace the host does not have.
 *
 * @category mcp
 * @since 0.1.0
 */
export async function readMcpWorkspace(kernel: Kernel, id: WorkspaceId): Promise<McpWorkspace> {
  const record = await readWorkspace(kernel, id);

  if (record === null) throw new SdkError("unknown", `Workspace ${id} is not registered.`);
  const { target } = record;

  return {
    id,
    root: target.kind === "local" && "path" in target ? target.path : null,
    trusted: (await projectTrust(kernel, record)) === true,
  };
}

/** The `workspace(id).mcp` of a workspace on this kernel, over its hub. */
export function mcpApi(kernel: Kernel, id: WorkspaceId): McpApi {
  const hub = (): McpHub => {
    if (kernel.mcp === null) throw new SdkError("unavailable", "This host has no MCP servers.");

    return kernel.mcp;
  };

  const act = async <T>(run: (hub: McpHub, workspace: McpWorkspace) => Promise<T>): Promise<T> =>
    run(hub(), await readMcpWorkspace(kernel, id));

  return {
    watch: () => forwarded(async () => hub().watch(await readMcpWorkspace(kernel, id))),
    reconnect: (server) => act((mcp, workspace) => mcp.reconnect(workspace, server)),
    setEnabled: (server, enabled) =>
      act((mcp, workspace) => mcp.setEnabled(workspace, server, enabled)),
    login(server) {
      let login: Promise<Login> | null = null;
      const begin = (): Promise<Login> =>
        (login ??= act(async (mcp, workspace) => mcp.login(workspace, server)));

      return {
        steps: () => forwarded(async () => (await begin()).steps()),
        async answer(code) {
          if (login === null)
            throw new SdkError("invalid", "Read the login's steps before answering.");
          await (await login).answer(code);
        },
      };
    },
    logout: (server) => act((mcp, workspace) => mcp.logout(workspace, server)),
    add: (server, config, scope) =>
      act((mcp, workspace) => mcp.add(workspace, server, config, scope)),
    remove: (server, scope) => act((mcp, workspace) => mcp.remove(workspace, server, scope)),
  };
}
