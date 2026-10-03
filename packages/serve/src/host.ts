/**
 * One trusted folder composed the way the terminal composes it, with this
 * process volunteering as the runner for any session a remote client drives,
 * and the machine's environment beside it: provider sign-in and preferences,
 * this folder's usage history, and the GitHub login.
 */
import { createNyteModels } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import type { Nyte, SessionId, TrustedWorkspace } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import {
  createGitHubService,
  createHost,
  createWorkspaceBackend,
  createWorkspaceStore,
  nyteHome,
  WorkspaceTrustRequired,
  workspaceStorePath,
} from "@nyte-ai/host";
import type { GitHubCommandRunner } from "@nyte-ai/host";
import { createModelPreferencesStore, readCatalog } from "@nyte-ai/host/catalog";
import type { ModelPreferencesStore, ResolvedCatalog } from "@nyte-ai/host/catalog";
import { createProviderEnvironment } from "@nyte-ai/host/environment";
import { catalogForUsage, projectUsageReport, UsageScanner } from "@nyte-ai/host/store-usage";
import type { StoreRead } from "@nyte-ai/host/store-usage";
import { readAccountUsage } from "@nyte-ai/host/usage";
import type { Environment, UsageSnapshot, UsageWindow } from "@nyte-ai/protocol";

interface ServedHostOptions {
  readonly cwd: string;
  readonly onDiagnostic: (message: string) => void;
  /** The provider catalog and credentials; `~/.nyte`'s when omitted. */
  readonly models?: MutableModels;
  readonly runGitHubCommand?: GitHubCommandRunner;
}

export interface ServedHost {
  readonly sdk: Nyte;
  readonly environment: Environment;
  readonly workspace: TrustedWorkspace;
  /** Volunteer this process as the runner for a session a remote client drives. */
  readonly attach: (sessionId: SessionId) => void;
  close(): Promise<void>;
}

/** Long enough for a provider round trip, short enough that Usage still paints. */
const ACCOUNT_LIMITS_TIMEOUT_MS = 10_000;

/** The raw cause goes to diagnostics; a remote client reads only this. */
const STORE_FAILURE = "Couldn't read this folder's chat history.";

/**
 * The catalog a new chat starts from. Signed-in providers refresh first so
 * their account's models count; with none signed in, the full catalog
 * refreshes so the shell still opens.
 */
async function startingCatalog(
  models: MutableModels,
  preferences: ModelPreferencesStore,
): Promise<Required<ResolvedCatalog>> {
  const signedIn = (
    await Promise.all(
      models
        .getProviders()
        .map(async (provider) =>
          (await models.checkAuth(provider.id)) === undefined ? [] : [provider.id],
        ),
    )
  ).flat();

  await models.refresh({ providers: signedIn });
  let resolved = await readCatalog(models, await preferences.read());

  if (resolved.defaultModel === undefined) {
    await models.refresh();
    resolved = await readCatalog(models, await preferences.read());
  }

  const { catalog, defaultModel } = resolved;

  if (defaultModel === undefined) {
    throw new Error(
      "No models are available. Check your connection, then run `nyte update --models`.",
    );
  }

  return { catalog, defaultModel };
}

export async function openServedHost(options: ServedHostOptions): Promise<ServedHost> {
  const workspaces = createWorkspaceStore();
  let workspace: TrustedWorkspace;

  try {
    workspace = await workspaces.require(options.cwd);
  } catch (cause) {
    if (!(cause instanceof WorkspaceTrustRequired)) throw cause;

    throw new Error(
      `${cause.cwd} is not trusted. Run again with --trust to allow Nyte to read this folder and run tools in it.`,
      { cause },
    );
  }

  const workspaceBackend = createWorkspaceBackend(workspaces);
  const models = options.models ?? createNyteModels();
  const preferences = createModelPreferencesStore();
  const { catalog: starting, defaultModel } = await startingCatalog(models, preferences);
  const storePath = await workspaceStorePath(workspace.cwd);
  const store = new SqliteStore(storePath);
  let sdk: Nyte;

  try {
    sdk = await createHost({
      store,
      models,
      model: defaultModel,
      thinkingLevel: starting.defaults?.thinkingLevel,
      onDiagnostic: (diagnostic) =>
        options.onDiagnostic(
          `${diagnostic.operation} failed (${diagnostic.correlationId}): ${String(diagnostic.cause)}`,
        ),
      workspace: {
        ...workspaceBackend,
        list: async () =>
          (await workspaceBackend.list()).filter((info) => info.path === workspace.cwd),
      },
      plugins: {
        kind: "workspace",
        target: { kind: "project", workspace },
        onFailure: (failure) => options.onDiagnostic(`plugin ${failure.path}: ${failure.error}`),
      },
    });
  } catch (cause) {
    await store.close().catch(() => undefined);
    throw cause;
  }

  const catalog = async () => (await readCatalog(models, await preferences.read())).catalog;
  const scanner = new UsageScanner(nyteHome());

  /** This folder's store is the one Nyte history a single-folder server has. */
  const usage = async (window: UsageWindow): Promise<UsageSnapshot> => {
    const workspacePath = workspace.cwd;

    const scan = await scanner.scan({
      stores: [{ workspacePath, path: storePath }],
      catalog: catalogForUsage(models),
    });

    const [scanned] = scan.stores;

    if (scanned !== undefined && scanned.failure !== null) {
      options.onDiagnostic(`usage: reading ${storePath} failed: ${scanned.failure}`);
    }

    const read: StoreRead =
      scanned === undefined || scanned.failure !== null
        ? { workspacePath, sessions: [], failure: { message: STORE_FAILURE } }
        : { workspacePath, sessions: scanned.sessions, failure: null };

    return {
      ...projectUsageReport([read], window, Date.now()),
      nyteError: null,
      claudeCode: scan.claudeCode,
      codex: scan.codex,
    };
  };

  const providers = createProviderEnvironment({
    catalog,
    setPreference: async (change) => {
      await preferences.update(change);
    },
    usage,
    accountLimits: () => {
      const signal = AbortSignal.timeout(ACCOUNT_LIMITS_TIMEOUT_MS);

      return Promise.all([
        readAccountUsage({ models, provider: "anthropic", signal }),
        readAccountUsage({ models, provider: "openai-codex", signal }),
      ]);
    },
    login: (...input) => models.login(...input),
    refresh: async (provider, signal) => {
      const refreshed = await models.refresh({ providers: [provider], force: true, signal });

      return !refreshed.aborted && refreshed.errors.size === 0;
    },
    logout: (provider) => models.logout(provider),
  });

  const github = createGitHubService({ run: options.runGitHubCommand });
  const attached = new Set<SessionId>();

  return {
    workspace,
    sdk: {
      ...sdk,
      provider: {
        ...sdk.provider,
        models: {
          ...sdk.provider.models,
          // The picker rule is the catalog's: preferences hide what they turn off.
          list: async () => {
            const [{ models: entries }, served] = await Promise.all([
              catalog(),
              sdk.provider.models.list(),
            ]);

            const listed = new Set(
              entries.filter((entry) => entry.listed).map((entry) => entry.key),
            );

            return served.filter((model) => listed.has(`${model.provider}/${model.id}`));
          },
        },
      },
    },
    environment: {
      ...providers.operations,
      "environment.github.state": () => github.state(workspace.cwd),
      "environment.github.signIn": () => github.signIn(workspace.cwd),
      "environment.github.signOut": () => github.signOut(workspace.cwd),
      "environment.github.createPullRequest": (input) =>
        github.createPullRequest(input, workspace.cwd),
    },
    attach: (sessionId) => {
      if (attached.has(sessionId)) return;
      attached.add(sessionId);
      sdk.attach({ sessions: [sessionId] });
    },
    async close() {
      github.close();

      try {
        await providers.close();
        await sdk.close();
      } finally {
        await store.close();
      }
    },
  };
}
