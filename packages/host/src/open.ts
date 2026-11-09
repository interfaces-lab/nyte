import { mkdir, readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { Models, Provider } from "@nyte-ai/ai";
import { defaultProviderAuthContext } from "@nyte-ai/ai/auth/context";
import { FileModelsStore, nyteProviders } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import { isJson, SdkError } from "@nyte-ai/schema";
import type { HostDescription, Json, ValidationIssue, WorkspaceTarget } from "@nyte-ai/schema";
import { dev, processEnvironment } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import type { ServerHost } from "@nyte-ai/core/server";
import { readModelSelection } from "@nyte-ai/core/store";
import type { Host, ListenOptions, Listener, OpenOptions, Plugin, Store } from "@nyte-ai/core";
import approvals from "@nyte-ai/plugin/core/approvals";
import { acpAgents } from "@nyte-ai/plugin/core/acp";
import bashDescription from "@nyte-ai/plugin/core/bash-description";
import type { ClientActions } from "@nyte-ai/plugin/core/browser-client";
import browserTools from "@nyte-ai/plugin/core/browser-tools";
import canvas from "@nyte-ai/plugin/core/canvas";
import { claudeCodeSdk } from "@nyte-ai/plugin/core/claude-code-sdk";
import codemode from "@nyte-ai/plugin/core/codemode";
import openaiAstraContext from "@nyte-ai/plugin/core/openai-astra-context";
import { openaiCompaction } from "@nyte-ai/plugin/core/openai-compaction";
import question from "@nyte-ai/plugin/core/question";
import rename from "@nyte-ai/plugin/core/rename";
import secretRequests from "@nyte-ai/plugin/core/secret";
import subagents from "@nyte-ai/plugin/core/subagents";
import telemetry from "@nyte-ai/plugin/core/telemetry";
import toolSearch from "@nyte-ai/plugin/core/tool-search";
import web from "@nyte-ai/plugin/core/web";
import manifest from "../package.json" with { type: "json" };
import { credentialStore } from "./credentials.ts";
import { identitySigner } from "./identity-key.ts";
import { readErrorCode } from "./local/tree.ts";
import { localDocuments } from "./local/documents.ts";
import { localGitHubAccount } from "./local/github.ts";
import { localProvider } from "./local/provider.ts";
import { importLegacyTrust } from "./local/legacy-trust.ts";
import { migrateLocalWorkspaceIdentities } from "./local/workspace-migration.ts";
import { listen } from "./listen.ts";
import { nodeImages } from "./images/node.ts";
import { createMcpHub } from "./mcp/hub.ts";
import type { ClientMetadataFetch } from "./mcp-server/client-metadata.ts";
import { openMcpServer } from "./mcp-server/server.ts";
import { createViewCompiler } from "./plugins/views.ts";
import { performOffered, sharedClients } from "./serve/clients.ts";
import { createPluginLoader } from "./plugins/loader.ts";
import type { PluginImport } from "./plugins/loader.ts";
import { defaultSecrets } from "./secrets.ts";
import type { SecretsSource } from "./secrets.ts";
import { sqliteStore, storePath } from "./sqlite.ts";
import { openTailnet } from "./tailnet.ts";

declare const NYTE_BUILT_VERSION: string | undefined;

const STORE_POLL_MS = 500;

export type OpenHostOptions = Omit<OpenOptions, "store" | "workspace" | "models" | "plugins"> & {
  readonly store?: Store;
  readonly workspace?: WorkspaceTarget;
  readonly models?: Models;
  readonly plugins?: readonly Plugin<"core">[];
  readonly home?: string;
  readonly shell?: () => string | null;
  readonly label?: string;
  readonly onRevoked?: () => void;
  /** Called before the default store migrates existing data, which blocks this thread until it ends. */
  readonly onStoreMigration?: () => void;
  /** How plugin files are imported fresh; Node's resolve hook (`nodePluginImport`) by default. A Bun host passes its own. */
  readonly pluginImport?: PluginImport;
  readonly tailnet?: { readonly binary: string };
  readonly clientPlugins?: (actions: ClientActions) => readonly Plugin<"core">[];
  /** How the MCP authorization server fetches a client's metadata document; from public https addresses only by default. */
  readonly fetchClientMetadata?: ClientMetadataFetch;
};

export async function openHost(options: OpenHostOptions = {}): Promise<Host> {
  const home = options.home ?? homedir();
  const workspace = options.workspace ?? { kind: "local", path: process.cwd() };

  if (options.store !== undefined)
    return composeOpen(options, { home, workspace, store: options.store, owned: null });
  const owned = await defaultStore(home, options.onStoreMigration);

  try {
    return await composeOpen(options, { home, workspace, store: owned, owned });
  } catch (cause) {
    await owned.close().catch(() => undefined);
    throw cause;
  }
}

async function defaultStore(home: string, onMigrate?: () => void): Promise<Store> {
  const path = storePath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  return sqliteStore({ path, onMigrate });
}

async function composeOpen(
  options: OpenHostOptions,
  input: {
    readonly home: string;
    readonly workspace: WorkspaceTarget;
    readonly store: Store;
    readonly owned: Store | null;
  },
): Promise<Host> {
  const { home, workspace, store, owned } = input;
  const secrets = options.secrets ?? defaultSecrets(home);
  const description = hostDescription();
  let server: ServerHost | null = null;

  const actions: ClientActions = {
    offered: (action) =>
      server !== null &&
      sharedClients(server)
        .rows()
        .some((row) => row.actions.some((declared) => declared.name === action)),
    perform: (action, input, timeoutMs) =>
      server === null
        ? Promise.reject(new SdkError("unavailable", "The host is still opening."))
        : performOffered(server, { action, input, timeoutMs }),
  };

  const given = [...(options.plugins ?? []), ...(options.clientPlugins?.(actions) ?? [])];
  const usesLocalProvider = !given.some((plugin) => plugin.environment?.kind === "local");

  const claudeCode = claudeCodeSdk();
  const acp = acpAgents();

  const [models, settings] = await Promise.all([
    options.models ??
      nyteModels({ store, secrets, home, providers: [claudeCode.provider, acp.provider] }),
    settingsSeed(home),
    usesLocalProvider
      ? store.open().then(async (connection) => {
          await migrateLocalWorkspaceIdentities(connection);
          await importLegacyTrust(connection, home);
        })
      : undefined,
  ]);

  const builtins = [
    approvals,
    question,
    secretRequests,
    rename,
    subagents,
    bashDescription,
    web,
    codemode,
    toolSearch,
    openaiCompaction(models),
    openaiAstraContext,
    telemetry,
    canvas,
    claudeCode.plugin,
    acp.plugin,
  ];

  const plugins = [
    ...(usesLocalProvider
      ? [{ id: "local", environment: localProvider({ home, shell: options.shell }) }]
      : []),
    ...builtins.filter((builtin) => !given.some((plugin) => plugin.id === builtin.id)),
    ...given,
  ];

  let projectDirs: () => Promise<readonly string[]> = async () => [];
  const documentsClosed = new AbortController();

  const loader = createPluginLoader({
    dirs: async () => [join(home, ".nyte", "plugins"), ...(await projectDirs())],
    import: options.pluginImport,
  });

  const host = await composeHost({
    ...options,
    store,
    workspace,
    loadPlugins: (paths) => loader.load(paths),
    loadPluginDirectory: (dir) => loader.directory(dir),
    compileView: createViewCompiler(),
    models,
    mcp: options.mcp ?? createMcpHub({ home }),
    github: options.github ?? (usesLocalProvider ? localGitHubAccount({ home }) : undefined),
    documents:
      options.documents ?? (usesLocalProvider ? localDocuments(documentsClosed.signal) : undefined),
    images: options.images ?? nodeImages(),
    plugins,
    secrets,
    home,
    description,
    ...(settings.seed === null ? {} : { seed: settings.seed }),
    ...(owned === null ? {} : { poll: STORE_POLL_MS }),
    member: {
      label: options.label ?? "nyte",
      pid: process.pid,
      capabilities: given.some((plugin) => plugin.id === browserTools.id) ? [browserTools.id] : [],
    },
    revoked: options.onRevoked,
  }).catch((error: unknown) => {
    loader.close();
    documentsClosed.abort();

    throw error;
  });

  server = host.server;

  projectDirs = async () =>
    (await host.workspaces.list()).flatMap((entry) =>
      entry.trusted === true && "path" in entry.target
        ? [join(entry.target.path, ".nyte", "plugins")]
        : [],
    );

  if (settings.issue !== null)
    host.server.report({
      id: "settings",
      source: "user",
      path: settingsPath(home),
      issues: [settings.issue],
    });

  dev("open", "host", { home, seedIds: Object.keys(settings.seed?.settings ?? {}).length });

  const listeners = new Set<Listener>();
  let identity: ReturnType<typeof identitySigner> | null = null;

  const tailnet = await openTailnet({
    host,
    home,
    binary: options.tailnet?.binary ?? join(dirname(process.execPath), "nyte-tailnet"),
    version: description.version,
  });

  const mcpServer = openMcpServer({
    server: host.server,
    home,
    version: description.version,
    fetchClientMetadata: options.fetchClientMetadata,
  });

  const attach = async (listenOptions: ListenOptions): Promise<Listener> => {
    const listener = await listen(host, {
      describe: () => description,
      tailnet,
      mcpServer,
      ...listenOptions,
      identity: listenOptions.identity ?? (await (identity ??= identitySigner(host.hostId, home))),
    });

    listeners.add(listener);
    dev("open", "listen", { address: listener.address });

    return listener;
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      for (const listener of listeners) await listener.close();
      await tailnet.close();
      await host.close();
      documentsClosed.abort();
      loader.close();
      await owned?.close();
    })();

    return closing;
  };

  return { ...host, listen: attach, close, [Symbol.asyncDispose]: close };
}

async function nyteModels(input: {
  readonly store: Store;
  readonly secrets: SecretsSource;
  readonly home: string;
  readonly providers: readonly Provider[];
}): Promise<Models> {
  const credentials = credentialStore(input.store, input.secrets);
  const auth = defaultProviderAuthContext();

  const models = createModels({
    credentials,
    modelsStore: new FileModelsStore(join(input.home, ".nyte", "models-store.json")),
    authContext: {
      ...auth,
      env: async (name) => {
        await processEnvironment();

        return auth.env(name);
      },
    },
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of [...nyteProviders(), ...input.providers]) models.setProvider(provider);

  const [stored, selected] = await Promise.all([
    credentials.list(),
    input.store.open().then(readModelSelection),
  ]);

  const restored = await models.refresh({
    providers: [
      ...new Set([
        ...stored.map((row) => row.providerId),
        ...input.providers.map((provider) => provider.id),
        ...(selected === null ? [] : [selected.provider]),
      ]),
    ],
    allowNetwork: false,
  });

  dev("open", "models restored", {
    providers: stored.length,
    failed: [...restored.errors.keys()],
  });

  return models;
}

async function settingsSeed(home: string): Promise<{
  readonly seed: {
    readonly settings: Readonly<Record<string, Json>>;
    readonly path: string;
  } | null;
  readonly issue: ValidationIssue | null;
}> {
  const path = settingsPath(home);

  const text = await readFile(path, "utf8").catch((error: unknown) =>
    readErrorCode(error) === "ENOENT"
      ? null
      : error instanceof Error
        ? error
        : new Error(String(error)),
  );

  if (text === null) return { seed: null, issue: null };

  if (text instanceof Error)
    return {
      seed: null,
      issue: { severity: "warning", path: [], message: `${path} cannot be read: ${text.message}` },
    };
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {
      seed: null,
      issue: { severity: "warning", path: [], message: `${path} is not a JSON object.` },
    };

  const settings: Record<string, Json> = {};

  for (const [id, value] of Object.entries(parsed)) if (isJson(value)) settings[id] = value;

  return { seed: { settings, path }, issue: null };
}

function hostDescription(): HostDescription {
  return {
    name: hostname(),
    platform: process.platform,
    version: typeof NYTE_BUILT_VERSION === "string" ? NYTE_BUILT_VERSION : manifest.version,
  };
}

function settingsPath(home: string): string {
  return join(home, ".nyte", "settings.json");
}
