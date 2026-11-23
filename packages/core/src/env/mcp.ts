import { SdkError } from "@nyte-ai/schema";
import type { McpView, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Login } from "../contract/host.ts";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import type { McpApi, McpHub, McpWorkspace } from "../contract/workspace.ts";
import { requireSession } from "../store/session.ts";
import { closable, forwarded } from "../util/iterable.ts";
import { readWorkspace } from "./environment.ts";
import { projectTrust } from "./trust.ts";

export async function readMcpWorkspace(kernel: Kernel, id: WorkspaceId): Promise<McpWorkspace> {
  const record = await readWorkspace(kernel.store, id);

  if (record === null) throw new SdkError("unknown", `Workspace ${id} is not registered.`);
  const { target } = record;

  return {
    id,
    root: target.kind === "local" && "path" in target ? target.path : null,
    trusted: await projectTrust(kernel, record),
  };
}

const READY_MS = 5000;

export async function awaitMcpServers(
  kernel: Kernel,
  runtime: PluginRuntime,
  session: SessionId,
  signal: AbortSignal,
): Promise<void> {
  if (kernel.mcp === null) return;
  const { workspace } = (await requireSession(kernel.store, session)).record;

  if (await kernel.mcp.ready(workspace, AbortSignal.any([signal, AbortSignal.timeout(READY_MS)]))) {
    await runtime.registries.materialize();
  }
}

export function mcpApi(kernel: Kernel, id: WorkspaceId): McpApi {
  const hub = (): McpHub => {
    if (kernel.mcp === null) throw new SdkError("unavailable", "This host has no MCP servers.");

    return kernel.mcp;
  };

  const act = async <T>(run: (hub: McpHub, workspace: McpWorkspace) => Promise<T>): Promise<T> =>
    run(hub(), await readMcpWorkspace(kernel, id));

  return {
    watch: () => followWorkspace(kernel, id, hub),
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
          if (login === null) {
            throw new SdkError("invalid", "Read the login's steps before answering.");
          }
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

function followWorkspace(
  kernel: Kernel,
  id: WorkspaceId,
  hub: () => McpHub,
): AsyncIterable<McpView> {
  return closable<McpView>(() => {
    let key: string | null = null;
    let views: AsyncIterator<McpView> | null = null;
    let pending: Promise<IteratorResult<McpView>> | null = null;
    let moved = Promise.withResolvers<null>();

    const listener = (changed: WorkspaceId): void => {
      if (changed === id) moved.resolve(null);
    };

    kernel.workspaceState.listeners.add(listener);

    const current = async (): Promise<AsyncIterator<McpView>> => {
      const workspace = await readMcpWorkspace(kernel, id);
      const next = JSON.stringify([workspace.root, workspace.trusted]);

      if (views !== null && next === key) return views;
      void views?.return?.();
      key = next;
      pending = null;
      views = hub().watch(workspace)[Symbol.asyncIterator]();

      return views;
    };

    return {
      async pull() {
        for (;;) {
          const open = await current();
          pending ??= open.next();
          const step = await Promise.race([pending, moved.promise]);

          if (step !== null) {
            pending = null;

            return step;
          }

          moved = Promise.withResolvers<null>();
        }
      },
      close() {
        kernel.workspaceState.listeners.delete(listener);
        void views?.return?.();
      },
    };
  });
}
