import { SdkError } from "@nyte-ai/schema";
import type { Capability, CredentialSource, WorkspaceId } from "@nyte-ai/schema";
import { ALL_AUTHORITY, LOCAL } from "../contract/host.ts";
import type { Connection, ConnectionContext, Host, PluginFile } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import type { Head, Session } from "../contract/session.ts";
import type { Workspace } from "../contract/workspace.ts";
import { advance, cover, repair } from "../drive/execution.ts";
import { gate, gated } from "../engine/principals.ts";
import { createWorkspaces, workspaceHandle } from "../env/workspaces.ts";
import { inspect } from "../store/inspect.ts";
import { watchHost } from "./host.ts";
import { createSessions, sessionHandle } from "./session.ts";

export function createConnection(kernel: Kernel, context: ConnectionContext): Connection {
  const { authority } = context;
  const streams = new Set<() => void>();
  const sessions = createSessions(kernel, context);

  const track = <T>(source: AsyncIterable<T>): AsyncIterable<T> => ({
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();

      const stop = (): void => {
        void iterator.return?.();
      };

      streams.add(stop);

      return {
        async next() {
          let done = true;

          try {
            const result = await iterator.next();
            done = result.done === true;

            return result;
          } finally {
            if (done) streams.delete(stop);
          }
        },
        async return() {
          streams.delete(stop);
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  });

  const head = (handle: Head): Head => ({
    ...handle,
    watch: (options) => track(handle.watch(options)),
  });

  const session = (handle: Session): Session => ({
    ...handle,
    watch: (options) => track(handle.watch(options)),
    head: (name) => head(handle.head(name)),
  });

  const capability = async <T extends object>(
    kind: string,
    found: () => Promise<Capability<T>>,
  ): Promise<Capability<T>> => {
    const provided = await found();

    return provided.kind === "available"
      ? { ...provided, api: gated(kind, provided.api, authority) }
      : provided;
  };

  const client = {};

  const workspace = (id: WorkspaceId): Workspace => {
    const handle = workspaceHandle(kernel, context, id, client);

    return gated("workspace", handle, authority, {
      mcp: gated("mcp", handle.mcp, authority, {
        async *watch() {
          gate(authority, "mcp.watch");
          yield* handle.mcp.watch();
        },
        login(server) {
          gate(authority, "mcp.login");

          return handle.mcp.login(server);
        },
      }),
      files: () => capability("files", () => handle.files()),
      git: () => capability("git", () => handle.git()),
      browser: () => capability("browser", () => handle.browser()),
    });
  };

  const close = async (): Promise<void> => {
    for (const stop of streams) stop();
    streams.clear();
    await kernel.pages.release({ client });
  };

  return {
    hostId: kernel.hostId,
    principal: context.principal,
    credential: context.credential,
    sessions: {
      watch: (input) => track(sessions.watch(input)),
      create: async (input) => session(await sessions.create(input)),
      list: (input) => sessions.list(input),
    },
    workspaces: gated("workspaces", createWorkspaces(kernel, context), authority),
    session: (id) => session(sessionHandle(kernel, context, id)),
    workspace,
    watch: () =>
      track(watchHost(kernel, { principal: context.principal, authority: context.authority })),
    async blob(id) {
      const reader = await kernel.store.objects.blob(id);

      if (reader === null) throw new SdkError("unknown", `No blob has the id ${id}.`);

      return reader;
    },
    models: gated("models", kernel.models, authority, {
      login(input) {
        gate(authority, "models.login");

        return kernel.models.login(input);
      },
    }),
    settings: gated("settings", kernel.settings, authority),
    plugins: gated(
      "plugins",
      {
        replace: async (plugins, scope) =>
          kernel.plugins.replace(await kernel.loadPlugins(listPluginPaths(plugins)), scope),
        check: async (plugins) =>
          kernel.plugins.check(await kernel.loadPlugins(listPluginPaths(plugins))),
      },
      authority,
    ),
    principals: gated("principals", kernel.principals, authority),
    close,
    [Symbol.asyncDispose]: close,
  };
}

export function createHost(
  kernel: Kernel,
  input: { readonly credential: CredentialSource },
): Omit<Host, "listen"> {
  const connection = createConnection(kernel, {
    principal: LOCAL,
    authority: ALL_AUTHORITY,
    credential: input.credential,
    origin: null,
  });

  return {
    ...connection,
    plugins: {
      replace: async (plugins, scope) =>
        kernel.plugins.replace(await loaded(kernel, plugins), scope),
      check: async (plugins) => kernel.plugins.check(await loaded(kernel, plugins)),
    },
    inspect: (session) => inspect(kernel.store, session),
    execution: {
      cover: (coverage) => cover(kernel, coverage),
      advance: (step) => advance(kernel, step),
      repair: (page) => repair(kernel, page),
    },
  };
}

function listPluginPaths(files: readonly PluginFile[]): readonly string[] {
  return files.map((file) => file.path);
}

async function loaded(
  kernel: Kernel,
  plugins: readonly (Plugin<"core"> | PluginFile)[],
): Promise<readonly Plugin<"core">[]> {
  const each = await Promise.all(
    plugins.map(async (plugin) =>
      isPluginFile(plugin) ? kernel.loadPlugins([plugin.path]) : [plugin],
    ),
  );

  return each.flat();
}

function isPluginFile(plugin: Plugin<"core"> | PluginFile): plugin is PluginFile {
  return "path" in plugin && !("id" in plugin);
}
