import { SdkError } from "@nyte-ai/schema";
import type { Capability, CredentialSource, WorkspaceId } from "@nyte-ai/schema";
import { ALL_AUTHORITY, LOCAL } from "../contract/host.ts";
import type {
  Connection,
  ConnectionContext,
  Host,
  ModelsApi,
  PluginFile,
} from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import type { Head, Session } from "../contract/session.ts";
import type { GitHubAccountApi, Workspace } from "../contract/workspace.ts";
import { advance, cover, repair } from "../drive/execution.ts";
import { createPrincipals, gate, gated } from "../engine/principals.ts";
import { createWorkspaces, workspaceHandle } from "../env/workspaces.ts";
import { createSettingsApi } from "../extend/settings.ts";
import {
  completeWorkspaceCommand,
  readWorkspaceCatalog,
  runWorkspaceCommand,
} from "../extend/workspace-commands.ts";
import { inspect } from "../store/inspect.ts";
import { forwarded, watchStore } from "../util/iterable.ts";
import { watchHost } from "./host.ts";
import { createSessions, sessionHandle } from "./session.ts";

const NO_GITHUB: GitHubAccountApi = {
  account: async () => unavailableGitHub(),
  signIn: async () => unavailableGitHub(),
  signOut: async () => unavailableGitHub(),
};

function unavailableGitHub(): never {
  throw new SdkError("unavailable", "This host has no GitHub CLI login to serve.");
}

/** Returns the connection a caller holds under `context`, each api gated by its authority; `models` is the host's models api, built once over its providers. */
export function createConnection(
  kernel: Kernel,
  models: ModelsApi,
  context: ConnectionContext,
): Connection {
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
    ...watchStore(() => track(handle.watch())),
  });

  const session = (handle: Session): Session => ({
    ...handle,
    watch: (options) => track(handle.watch(options)),
    ...watchStore(() => track(handle.watch())),
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
    const handle: Workspace = {
      ...workspaceHandle(kernel, context, id, client),
      catalog: () => readWorkspaceCatalog(kernel, id),
      command: (name, text) => runWorkspaceCommand(kernel, context, id, name, text),
      completeCommand: (name, prefix) =>
        completeWorkspaceCommand(kernel, context, id, name, prefix),
    };

    return gated("workspace", handle, authority, {
      mcp: gated("mcp", handle.mcp, authority, {
        watch: () =>
          forwarded(async () => {
            gate(authority, "mcp.watch");

            return handle.mcp.watch();
          }),
        login(server) {
          gate(authority, "mcp.login");

          return handle.mcp.login(server);
        },
      }),
      files: () => capability("files", () => handle.files()),
      git: () => capability("git", () => handle.git()),
      github: () => capability("github", () => handle.github()),
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
      async start(input) {
        const started = await sessions.start(input);

        return { ...started, session: session(started.session) };
      },
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
    models: gated("models", models, authority, {
      login(input) {
        gate(authority, "models.login");

        return models.login(input);
      },
    }),
    settings: gated("settings", createSettingsApi(kernel), authority),
    plugins: gated(
      "plugins",
      {
        replace: async (plugins, scope) =>
          kernel.plugins.replace(await kernel.plugins.load(listPluginPaths(plugins)), scope),
        check: async (plugins) =>
          kernel.plugins.check(await kernel.plugins.load(listPluginPaths(plugins))),
      },
      authority,
    ),
    principals: gated("principals", createPrincipals(kernel), authority),
    github: gated("github", kernel.github ?? NO_GITHUB, authority),
    close,
    [Symbol.asyncDispose]: close,
  };
}

export function createHost(
  kernel: Kernel,
  input: { readonly credential: CredentialSource },
): Omit<Host, "listen"> {
  const connection = kernel.handles.connection({
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
    plugins.map(async (plugin) => ("id" in plugin ? [plugin] : kernel.plugins.load([plugin.path]))),
  );

  return each.flat();
}
