import { join } from "node:path";
import { StdioTransport } from "@earendil-works/pi-mcp";
import type { McpClient, Tool } from "@earendil-works/pi-mcp";
import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import type { OAuthChallenge } from "@earendil-works/pi-mcp/oauth";
import { processEnvironment, closable, dev, forwarded, traced } from "@nyte-ai/core";
import type { Login, PluginStorage, ToolDefinition } from "@nyte-ai/core";
import type { McpHub, McpHubFactory, McpServerBrief, McpWorkspace } from "@nyte-ai/core/server";
import { isJson, isJsonObject, SdkError } from "@nyte-ai/schema";
import type {
  Disposer,
  McpChange,
  McpScope,
  McpServerState,
  McpServerView,
  McpView,
  ValidationIssue,
} from "@nyte-ai/schema";
import { watchPath } from "../local/tree.ts";
import { editMcpFile, parseMcpConfig, readMcpFile } from "./config.ts";
import type { McpConfig, McpFile, McpFileContents, McpServerEntry } from "./config.ts";
import { connectServer, oauthSettings } from "./connect.ts";
import type { McpConnector } from "./connect.ts";
import { oauthKey, oauthStore, signIn } from "./oauth.ts";
import { bridgeTools, checkToolSchemas, toolExposure, TracingMcpClient } from "./tools.ts";
import type { McpCall } from "./tools.ts";

const STDERR_TAIL = 4000;

const WATCH_DELAY_MS = 100;

const LINGER_MS = 30_000;

const UNTRUSTED: McpChange = {
  kind: "invalid",
  message: "Project servers need a trusted folder on this machine.",
};

/**
 * Serves the servers in `<home>/.nyte/mcp.json`, and in a trusted local
 * workspace's `.nyte/mcp.json`, to the host's sessions. Each file is watched
 * (created, edited, replaced or removed) without polling, and an edit applies
 * once the file system reports it: a changed server reconnects, an unchanged
 * one keeps its connection. A workspace's connections close 30 seconds after its last
 * watcher stops.
 *
 * @example
 * ```ts
 * const host = await openHost({ ...options, mcp: createMcpHub({ home: homedir() }) });
 * ```
 */
export function createMcpHub(input: {
  readonly home: string;
  readonly connect?: McpConnector;
}): McpHubFactory {
  return ({ secrets }) => hub({ ...input, connect: input.connect ?? connectServer, secrets });
}

type LinkState =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly tools: readonly Tool[];
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly kind: "needs-sign-in" }
  | { readonly kind: "failed"; readonly message: string; readonly stderr: string | null };

/** A server's last successful listing, kept while it reconnects so its sessions' tools and prompt do not change. */
type Listing = { readonly tools: readonly Tool[]; readonly instructions: string | null };

type Link = {
  readonly key: string;
  entry: McpServerEntry;
  readonly state: () => LinkState;
  readonly brief: () => McpServerBrief;
  /** The server's last OAuth challenge, which a sign-in follows for its scope and metadata. */
  readonly challenge: () => OAuthChallenge | null;
  readonly tools: () => readonly ToolDefinition[];
  /** The first connection attempt while it runs, or null once it has connected, failed or asked for sign-in, or the link closed. */
  readonly attempting: () => Promise<void> | null;
  close(): Promise<void>;
};

type Pool = {
  readonly key: string;
  readonly workspace: McpWorkspace;
  readonly files: readonly Omit<McpFile, "contents">[];
  config: McpConfig;
  readonly loaded: Promise<void>;
  /** True until `mcp.json` has been read and the links reconciled. */
  loading: boolean;
  readonly links: Map<string, Link>;
  readonly listeners: Set<() => void>;
  holders: number;
  linger: ReturnType<typeof setTimeout> | undefined;
};

function hub(input: {
  readonly home: string;
  readonly connect: McpConnector;
  readonly secrets: PluginStorage["secrets"];
}): McpHub {
  const pools = new Map<string, Pool>();
  const contents = new Map<string, McpFileContents>();
  const watched = new Map<string, Disposer>();
  const userPath = join(input.home, ".nyte", "mcp.json");
  let closed = false;

  const notify = (pool: Pool): void => {
    for (const listener of pool.listeners) listener();
  };

  const reconcile = (pool: Pool): void => {
    pool.config = parseMcpConfig(
      pool.files.map((file) => ({
        ...file,
        contents: contents.get(file.path) ?? { kind: "missing" },
      })),
    );

    for (const [name, link] of pool.links) {
      const entry = pool.config.servers.get(name);

      if (entry !== undefined && entry.enabled && linkKey(entry) === link.key) {
        link.entry = entry;

        continue;
      }

      pool.links.delete(name);
      void link.close();
    }

    for (const entry of pool.config.servers.values())
      if (entry.enabled && !pool.links.has(entry.name))
        pool.links.set(entry.name, openLink(entry, pool));

    notify(pool);
  };

  const openLink = (entry: McpServerEntry, pool: Pool): Link => {
    let state: LinkState = { kind: "connecting" };
    let listed: Listing | null = null;

    let bridged: {
      readonly entry: McpServerEntry;
      readonly listed: Listing;
      readonly tools: readonly ToolDefinition[];
    } | null = null;

    let client: McpClient | null = null;
    let stderr: () => string | null = () => null;
    let challenge: OAuthChallenge | null = null;
    let ended = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempted = Promise.withResolvers<void>();
    let attempting: Promise<void> | null = attempted.promise;

    const attempt = (): void => {
      attempting = null;
      attempted.resolve();
    };

    const set = (next: LinkState): void => {
      if (ended) return;
      state = next;

      if (next.kind !== "connecting") attempt();
      notify(pool);
    };

    const schedule = (wait: number): void => {
      clearTimeout(timer);

      if (!ended) timer = setTimeout(() => void connectTraced(), wait);
    };

    const retry = (): void => {
      schedule(delay);
      delay = Math.min(delay * 2, 30_000);
    };

    const drop = (message: string): void => {
      const previous = client;
      client = null;
      void previous?.close().catch(() => undefined);

      if (ended) return;
      set({ kind: "failed", message, stderr: stderr() });
      dev("mcp", "link failed", { server: entry.name, retryIn: delay });
      retry();
    };

    const connect = async (): Promise<void> => {
      if (link.entry.transport.kind === "stdio") await processEnvironment();

      if (ended) return;

      const next = new TracingMcpClient({
        name: "nyte",
        version: "0.1.0",
        requestTimeoutMs: link.entry.timeoutMs,
      });

      next.onClose(() => {
        if (client === next) drop(`The connection to ${entry.name} closed.`);
      });

      let transport: ReturnType<McpConnector>;

      try {
        transport = input.connect(link.entry, {
          workspace: pool.workspace,
          home: input.home,
          secrets: input.secrets,
          challenged: (next) => {
            challenge = next;
          },
        });
      } catch (error) {
        set({ kind: "failed", message: errorMessage(error), stderr: null });

        return;
      }

      try {
        stderr = () =>
          transport instanceof StdioTransport && transport.stderr !== ""
            ? transport.stderr.slice(-STDERR_TAIL)
            : null;
        await next.connect(transport);

        if (ended) {
          await next.close();

          return;
        }

        const refresh = async (): Promise<void> => {
          const offered = await next.listTools();

          if (client !== next) return;
          const { usable, issues } = checkToolSchemas(entry.name, offered);

          dev("mcp", "tools listed", { server: entry.name, tools: usable.length });
          listed = { tools: usable, instructions: next.instructions ?? null };
          set({ kind: "connected", tools: usable, issues });
        };

        client = next;
        delay = 1000;
        next.onNotification("notifications/tools/list_changed", async () => {
          try {
            await refresh();
          } catch (error) {
            if (client === next) drop(errorMessage(error));
          }
        });
        await refresh();
      } catch (error) {
        if (client === next) client = null;
        await next.close().catch(() => undefined);

        if (ended) return;

        if (error instanceof McpOAuthAuthorizationRequiredError) {
          if (state.kind !== "needs-sign-in") set({ kind: "needs-sign-in" });

          return;
        }

        set({
          kind: "failed",
          message: `${entry.name} failed to connect: ${errorMessage(error)}`,
          stderr: stderr(),
        });
        retry();
      }
    };

    const connectTraced = (): Promise<void> =>
      traced("mcp.connect", null, { server: entry.name }, connect);

    const call: McpCall = (name, args, options) => {
      if (client === null) throw new Error(notConnected(entry.name, state));

      return client.callTool(name, args, options);
    };

    const link: Link = {
      key: linkKey(entry),
      entry,
      state: () => state,
      brief: () => ({
        name: entry.name,
        instructions: listed?.instructions ?? null,
        unavailable:
          listed === null && (state.kind === "failed" || state.kind === "needs-sign-in")
            ? state.kind
            : null,
      }),
      challenge: () => challenge,
      tools() {
        if (listed === null) return [];

        if (bridged?.entry !== link.entry || bridged.listed !== listed)
          bridged = {
            entry: link.entry,
            listed,
            tools: bridgeTools(link.entry, listed.tools, call),
          };

        return bridged.tools;
      },
      attempting: () => attempting,
      async close() {
        ended = true;
        attempt();
        clearTimeout(timer);
        const previous = client;
        client = null;
        await previous?.close().catch(() => undefined);
      },
    };

    void connectTraced();

    return link;
  };

  const load = async (paths: readonly string[]): Promise<void> => {
    await Promise.all(
      paths.map(async (path) => {
        contents.set(path, await readMcpFile(path));
      }),
    );
  };

  const changed = (path: string): void => {
    void load([path]).then(() => {
      if (!watched.has(path)) {
        contents.delete(path);

        return;
      }

      for (const pool of pools.values())
        if (pool.files.some((file) => file.path === path)) reconcile(pool);
    });
  };

  const unfollow = (path: string): void => {
    if ([...pools.values()].some((pool) => pool.files.some((file) => file.path === path))) return;
    watched.get(path)?.();
    watched.delete(path);
    contents.delete(path);
  };

  const shut = (pool: Pool): void => {
    clearTimeout(pool.linger);

    if (pools.get(pool.key) !== pool) return;
    pools.delete(pool.key);

    for (const link of pool.links.values()) void link.close();
    pool.links.clear();
    notify(pool);

    for (const file of pool.files) unfollow(file.path);
  };

  const idle = (pool: Pool): void => {
    clearTimeout(pool.linger);

    if (closed || pools.get(pool.key) !== pool || pool.holders > 0) return;

    if (
      [...pools.values()].some(
        (other) => other !== pool && other.workspace.id === pool.workspace.id,
      )
    ) {
      shut(pool);

      return;
    }

    pool.linger = setTimeout(() => shut(pool), LINGER_MS);
    pool.linger.unref();
  };

  const open = (workspace: McpWorkspace): Pool => {
    const key = poolKey(workspace);
    const known = pools.get(key);

    if (known !== undefined) return known;

    const files: Omit<McpFile, "contents">[] = [
      { path: userPath, scope: "user" },
      ...(workspace.trusted && workspace.root !== null
        ? [{ path: join(workspace.root, ".nyte", "mcp.json"), scope: "project" as const }]
        : []),
    ];

    const unread = files.flatMap((file) => (watched.has(file.path) ? [] : [file.path]));

    for (const path of unread)
      watched.set(
        path,
        watchPath(path, { delay: WATCH_DELAY_MS }, () => changed(path)),
      );

    const pool: Pool = {
      key,
      workspace,
      files,
      config: { servers: new Map(), issues: [] },
      loaded: load(unread).then(() => {
        pool.loading = false;

        if (pools.get(key) === pool) reconcile(pool);
      }),
      loading: true,
      links: new Map(),
      listeners: new Set(),
      holders: 0,
      linger: undefined,
    };

    pools.set(key, pool);

    return pool;
  };

  const held = async <T>(workspace: McpWorkspace, run: (pool: Pool) => Promise<T>): Promise<T> => {
    if (closed) throw new SdkError("unavailable", "The host is closing.");
    const pool = open(workspace);
    pool.holders += 1;
    idle(pool);

    try {
      await pool.loaded;

      return await run(pool);
    } finally {
      pool.holders -= 1;
      idle(pool);
    }
  };

  const restart = (pool: Pool, server: string): void => {
    const link = pool.links.get(server);

    if (link !== undefined) {
      pool.links.delete(server);
      void link.close();
    }

    reconcile(pool);
  };

  const restartSignedIn = (key: string): void => {
    const signed = [...pools.values()].flatMap((pool) =>
      [...pool.links].flatMap(([server, link]) =>
        link.entry.transport.kind === "http" && oauthKey(server, link.entry.transport.url) === key
          ? [{ pool, server }]
          : [],
      ),
    );

    for (const { pool, server } of signed) restart(pool, server);
  };

  const write = async (
    path: string,
    change: Parameters<typeof editMcpFile>[1],
  ): Promise<McpChange> => {
    const outcome = await editMcpFile(path, change);

    if (outcome.kind !== "updated" || outcome.text === undefined) return outcome;
    contents.set(path, { kind: "text", text: outcome.text });

    for (const pool of pools.values())
      if (pool.files.some((file) => file.path === path)) reconcile(pool);

    return { kind: "updated" };
  };

  const fileFor = (pool: Pool, scope: McpScope): string | null =>
    pool.files.find((file) => file.scope === scope)?.path ?? null;

  const signingIn = new Set<string>();

  const view = (pool: Pool): McpView => ({
    issues: [
      ...pool.config.issues,
      ...[...pool.links.values()].flatMap((link) => {
        const state = link.state();

        return state.kind === "connected" ? state.issues : [];
      }),
    ],
    servers: [...pool.config.servers.values()]
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((entry): McpServerView => ({
        name: entry.name,
        scope: entry.scope,
        path: entry.path,
        override: entry.override,
        transport:
          entry.transport.kind === "stdio"
            ? { kind: "stdio", command: entry.transport.command, args: entry.transport.args }
            : { kind: "http", url: entry.transport.url },
        exposure: entry.exposure,
        description: entry.description,
        state: entry.enabled
          ? serverState(entry, pool.links.get(entry.name)?.state() ?? { kind: "connecting" })
          : { kind: "disabled" },
      })),
  });

  return {
    watch(workspace) {
      return closable<McpView>(() => {
        if (closed) return { pull: async () => ({ done: true, value: undefined }), close() {} };

        const pool = open(workspace);
        let dirty = true;
        let ended = false;
        let wake: (() => void) | null = null;

        const listener = (): void => {
          dirty = true;
          wake?.();
        };

        pool.holders += 1;
        idle(pool);
        pool.listeners.add(listener);

        return {
          async pull() {
            await pool.loaded;

            while (!dirty && !ended && !closed && pools.get(pool.key) === pool)
              await new Promise<void>((resolve) => (wake = resolve));
            wake = null;

            if (ended || closed || pools.get(pool.key) !== pool)
              return { done: true, value: undefined };
            dirty = false;

            return { done: false, value: view(pool) };
          },
          close() {
            if (ended) return;
            ended = true;
            wake?.();
            pool.listeners.delete(listener);
            pool.holders -= 1;
            idle(pool);
          },
        };
      });
    },
    tools(workspace) {
      const pool = pools.get(poolKey(workspace));

      return pool === undefined ? [] : [...pool.links.values()].flatMap((link) => link.tools());
    },
    briefs(workspace) {
      const pool = pools.get(poolKey(workspace));

      return pool === undefined
        ? []
        : [...pool.links.values()]
            .map((link) => link.brief())
            .toSorted((a, b) => a.name.localeCompare(b.name));
    },
    async ready(workspace, signal) {
      const watched = [...pools.values()].filter((pool) => pool.workspace.id === workspace);

      const attempting = (pool: Pool): Promise<void>[] =>
        [...pool.links.values()].flatMap((link) => link.attempting() ?? []);

      const attempts = watched.flatMap((pool) =>
        pool.loading
          ? [pool.loaded.then(() => Promise.all(attempting(pool))).then(() => undefined)]
          : attempting(pool),
      );

      if (attempts.length === 0 || signal.aborted) return false;
      const aborted = Promise.withResolvers<void>();

      signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      await Promise.race([Promise.all(attempts), aborted.promise]);

      return true;
    },
    reconnect: (workspace, server) =>
      held(workspace, async (pool) => {
        const entry = pool.config.servers.get(server);

        if (entry === undefined) return { kind: "missing" };

        if (!entry.enabled) return { kind: "invalid", message: `${server} is turned off.` };
        restart(pool, server);

        return { kind: "updated" };
      }),
    setEnabled: (workspace, server, enabled) =>
      held(workspace, async (pool) => {
        const entry = pool.config.servers.get(server);

        if (entry === undefined) return { kind: "missing" };
        const override = entry.override !== null;

        return write(entry.override ?? entry.path, (servers) => {
          const current = servers[server];

          if (!isJsonObject(current)) return null;
          const { enabled: _previous, ...rest } = current;

          return {
            ...servers,
            [server]: override
              ? { ...rest, enabled }
              : enabled
                ? rest
                : { ...rest, enabled: false },
          };
        });
      }),
    login(workspace, server) {
      let begun: Promise<Login> | null = null;

      const begin = (): Promise<Login> =>
        (begun ??= held(workspace, async (pool): Promise<Login> => {
          const entry = pool.config.servers.get(server);

          if (entry === undefined) return failedLogin(`No MCP server is named ${server}.`);
          const { transport } = entry;

          if (transport.kind !== "http")
            return failedLogin(`${server} runs a command, so it has nothing to sign in to.`);

          if (Object.keys(transport.headers).some((name) => name.toLowerCase() === "authorization"))
            return failedLogin(`${server} sends its own Authorization header.`);
          const key = oauthKey(server, transport.url);

          if (signingIn.has(key)) return failedLogin(`A sign-in to ${server} is already running.`);
          let settings: ReturnType<typeof oauthSettings>;

          try {
            settings = oauthSettings(transport.oauth, server);
          } catch (error) {
            return failedLogin(errorMessage(error));
          }

          signingIn.add(key);
          pool.holders += 1;

          return signIn({
            server,
            serverUrl: transport.url,
            store: oauthStore(input.secrets, key),
            settings,
            challenge: pool.links.get(server)?.challenge() ?? null,
            signedIn: () => restartSignedIn(key),
            ended: () => {
              signingIn.delete(key);
              pool.holders -= 1;
              idle(pool);
            },
          });
        }));

      return {
        steps: () => forwarded(async () => (await begin()).steps()),
        async answer(code) {
          if (begun === null)
            throw new SdkError("invalid", "Read the login's steps before answering.");
          await (await begun).answer(code);
        },
      };
    },
    logout: (workspace, server) =>
      held(workspace, async (pool) => {
        const entry = pool.config.servers.get(server);

        if (entry === undefined) return { kind: "missing" };

        if (entry.transport.kind !== "http")
          return { kind: "invalid", message: `${server} runs a command and has no sign-in.` };
        const key = oauthKey(server, entry.transport.url);
        await input.secrets.delete(key);
        restartSignedIn(key);

        return { kind: "updated" };
      }),
    add: (workspace, server, config, scope) =>
      held(workspace, async (pool) => {
        const path = fileFor(pool, scope);

        if (path === null) return UNTRUSTED;

        if (!isJson(config))
          return { kind: "invalid", message: "The server's config is not JSON." };

        const checked = parseMcpConfig([
          {
            path,
            scope: "user",
            contents: { kind: "text", text: JSON.stringify({ mcpServers: { [server]: config } }) },
          },
        ]);

        const [problem] = checked.issues;

        if (problem !== undefined) return { kind: "invalid", message: problem.message };

        return write(path, (servers) => ({ ...servers, [server]: config }));
      }),
    remove: (workspace, server, scope) =>
      held(workspace, async (pool) => {
        const path = fileFor(pool, scope);

        if (path === null) return UNTRUSTED;

        return write(path, (servers) => {
          if (!(server in servers)) return null;
          const { [server]: _removed, ...rest } = servers;

          return rest;
        });
      }),
    async close() {
      closed = true;
      const live = [...pools.values()];
      const links = live.flatMap((pool) => [...pool.links.values()]);

      for (const pool of live) shut(pool);
      await Promise.all(links.map((link) => link.close()));
    },
  };
}

function serverState(entry: McpServerEntry, state: LinkState): McpServerState {
  if (state.kind !== "connected") return state;

  return {
    kind: "connected",
    tools: state.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      exposure: toolExposure(entry, tool.name),
    })),
  };
}

function notConnected(server: string, state: LinkState): string {
  if (state.kind === "failed") return `${server} is not connected: ${state.message}`;

  if (state.kind === "needs-sign-in")
    return `${server} needs the user to sign in again before its tools work.`;

  return `${server} is reconnecting; try the call again shortly.`;
}

function poolKey(workspace: McpWorkspace): string {
  return JSON.stringify([workspace.id, workspace.root, workspace.trusted]);
}

function linkKey(entry: McpServerEntry): string {
  return JSON.stringify([entry.transport, entry.timeoutMs]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedLogin(reason: string): Login {
  return {
    async *steps() {
      yield { kind: "failed", reason };
    },
    answer: async () => undefined,
  };
}
