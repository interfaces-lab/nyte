/**
 * The bridge a browser installs: the SDK namespaces over `@nyte-ai/client`,
 * and a host namespace for remote-safe host operations. Native capabilities
 * such as terminals and browser surfaces are absent.
 *
 * Two kinds of host answer. A cursor host (a desktop share) selects a
 * folder on the server and lists its store. A registry host
 * (`info.workspaces.kind === "registry"`) exposes folders by id and starts
 * roots by request id; the selected folder is this browser's own, kept per
 * host identity and principal, and a root starts through `host.starts`.
 */
import { createNyteClient } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import type {
  HostIdentity,
  ServerInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceTarget,
} from "@nyte-ai/protocol";
import type {
  GitHubBridge,
  HostEvent,
  NyteBridge,
  OpenWorkspaceOutcome,
  RootStartInput,
  TrustConsent,
} from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { serverCatalog } from "../server-connection.ts";
import { deactivateOutbox } from "../use-outbox.ts";
import { requestFolderPath } from "./add-folder.tsx";
import { createSessionDirectory } from "./directory.ts";
import { IdentityChanged, randomNonce, verifyIdentityChallenge } from "./identity.ts";
import { createRegistryController } from "./registry.ts";
import type { RegistryController } from "./registry.ts";
import { createEnvironmentSignIn, webPageUrl } from "./sign-in.ts";
import { createIndexedDbStartJournal, createMemoryStartJournal } from "./start-journal.ts";

export interface Connection {
  readonly url: string;
  readonly token: string;
}

export interface ConnectOptions {
  readonly signal?: AbortSignal;
  readonly relay?: true;
  /**
   * The host identity this browser pinned when it first paired here. The
   * signed challenge must match it; a host that answers with another key is
   * refused with `IdentityChanged`. Absent on the first pairing: the identity
   * `info` reports is the one to pin.
   */
  readonly identity?: HostIdentity;
  /** The principal the host knows this browser as: a device id on the relay, the bearer otherwise. */
  readonly principal?: string;
}

export interface WebBridge {
  readonly bridge: NyteBridge;
  /** Verify with GET /v1/info, then route every call to this server. Rejects with the client's NyteWireError/NyteTransportError on failure. */
  connect(connection: Connection, options?: ConnectOptions): Promise<ServerInfo>;
}

const REFRESH_MS = 10_000;

const NOT_CONNECTED = "The app is not connected to a server.";

const SERVER = "Change servers from the connect screen.";

const REMOTE_ACCESS = "Remote access is turned on from the desktop app.";

const refuse = (message: string) => (): Promise<never> => Promise.reject(new Error(message));

/** `NodeJS.Platform` names the browser's OS, which is what shortcuts and chrome follow. */
function browserPlatform(): NodeJS.Platform {
  const name = `${navigator.platform} ${navigator.userAgent}`;

  if (/Mac|iPhone|iPad/i.test(name)) return "darwin";

  if (/Win/i.test(name)) return "win32";

  return "linux";
}

function openOutcome(outcome: WorkspaceSelectOutcome): OpenWorkspaceOutcome {
  switch (outcome.kind) {
    case "opened":
      return outcome.selection.kind === "project"
        ? { kind: "opened", workspace: outcome.selection.workspace, needsTrust: false }
        : { kind: "failed", message: "The server selected Home instead of this folder." };
    case "unavailable":
      return { kind: "failed", message: "This folder is not available on the server." };
    case "untrusted":
      return { kind: "needs_trust", path: outcome.path };
    case "failed":
      return { kind: "failed", message: outcome.message };
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

export function createWebBridge(): WebBridge {
  let client: NyteClient | undefined;
  let environment: ServerInfo["environment"];
  let relay: true | undefined;
  let registry: RegistryController | undefined;
  let polling = false;
  const listeners = new Set<(event: HostEvent) => void>();

  const journal =
    typeof indexedDB === "undefined" ? createMemoryStartJournal() : createIndexedDbStartJournal();

  const connected = (): Promise<NyteClient> =>
    client === undefined ? Promise.reject(new Error(NOT_CONNECTED)) : Promise.resolve(client);

  const call =
    <A extends readonly unknown[], R>(pick: (client: NyteClient) => (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      connected().then((current) => pick(current)(...args));

  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const environmentCall: NyteClient["environment"] = (operation, input) =>
    connected().then((current) => current.environment(operation, input));

  const signIn = createEnvironmentSignIn({ environment: environmentCall, emit });

  const directory = createSessionDirectory({
    current: () =>
      registry === undefined
        ? call((current) => current.workspace.current)()
        : registry.selection(),
    list: async (input) => {
      const page = await call((current) => current.sessions.list)(input);

      return registry === undefined ? page : registry.sessions(page);
    },
    emit,
  });

  /** A background sweep that fails leaves the directory as last read; the next one tries again. */
  const refreshQuietly = (): void => {
    directory.refresh().catch(() => undefined);
  };

  const mutate =
    <A extends readonly unknown[], R>(pick: (client: NyteClient) => (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await call(pick)(...args);
      refreshQuietly();

      return result;
    };

  /**
   * Where a workspace operation acts. The renderer names the open folder as
   * the host's cursor; on a registry host that is this browser's selected
   * folder by id. A session target already names its own folder and passes.
   */
  const retarget = (
    route: RegistryController | undefined,
    target: WorkspaceTarget,
  ): WorkspaceTarget => {
    if (route === undefined || target.kind !== "workspace") return target;
    const selected = route.selectedId();

    if (selected === undefined) throw new Error("Choose a folder on the host first.");

    return { kind: "registered", id: selected };
  };

  /** The client and the registry are read together, so a target always goes to the host it names. */
  const targeted =
    <I extends { readonly target: WorkspaceTarget }, R>(
      pick: (client: NyteClient) => (input: I) => Promise<R>,
    ) =>
    (input: I): Promise<R> => {
      const route = registry;

      return connected().then((current) =>
        pick(current)({ ...input, target: retarget(route, input.target) }),
      );
    };

  const select = async (input: WorkspaceSelectInput): Promise<WorkspaceSelectOutcome> => {
    const outcome = await call((current) => current.workspace.select)(input);

    if (outcome.kind === "opened") directory.follow(outcome.selection);
    refreshQuietly();

    return outcome;
  };

  const openOn = (route: RegistryController, path: string): Promise<OpenWorkspaceOutcome> => {
    const opening = route.open({ path });
    void opening.then(refreshQuietly);

    return opening;
  };

  /** A dialog answered after the connection moved on belongs to the host it was asked for. */
  const CONNECTION_CHANGED: OpenWorkspaceOutcome = {
    kind: "failed",
    message: "The connection changed while this was open. Try again on this host.",
  };

  const openWorkspace = ({ path }: { path: string }): Promise<OpenWorkspaceOutcome> => {
    if (registry !== undefined) return openOn(registry, path);

    return select({ kind: "project", path }).then(openOutcome, (cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: errorMessage(cause),
    }));
  };

  const poll = (): void => {
    if (document.visibilityState === "visible") refreshQuietly();
  };

  const github: GitHubBridge = {
    state: () => environmentCall("environment.github.state", undefined),
    signIn: () => environmentCall("environment.github.signIn", undefined),
    signOut: () => environmentCall("environment.github.signOut", undefined),
    createPullRequest: (input) => environmentCall("environment.github.createPullRequest", input),
  };

  const bridge: NyteBridge = {
    clientSurface: "web",
    get environment() {
      return environment;
    },
    get relay() {
      return relay;
    },
    sessions: {
      create: mutate((current) => current.sessions.create),
      get: call((current) => current.sessions.get),
      snapshot: call((current) => current.sessions.snapshot),
      metadata: call((current) => current.sessions.metadata),
      list: call((current) => current.sessions.list),
      rename: mutate((current) => current.sessions.rename),
      setPinned: mutate((current) => current.sessions.setPinned),
      setArchived: mutate((current) => current.sessions.setArchived),
      delete: mutate((current) => current.sessions.delete),
      configure: mutate((current) => current.sessions.configure),
    },
    messages: {
      send: mutate((current) => current.messages.send),
      cancel: mutate((current) => current.messages.cancel),
      redeliver: call((current) => current.messages.redeliver),
    },
    jobs: {
      list: call((current) => current.jobs.list),
      start: call((current) => current.jobs.start),
      background: call((current) => current.jobs.background),
      cancel: call((current) => current.jobs.cancel),
    },
    runs: {
      abort: mutate((current) => current.runs.abort),
      reply: mutate((current) => current.runs.reply),
      diff: call((current) => current.runs.diff),
    },
    heads: {
      move: mutate((current) => current.heads.move),
    },
    workspace: {
      list: (input) =>
        registry === undefined ? call((current) => current.workspace.list)(input) : registry.list(),
      forget: (input) =>
        registry === undefined
          ? mutate((current) => current.workspace.forget)(input)
          : registry.forget(input).then(refreshQuietly),
      files: targeted((current) => current.workspace.files),
      read: targeted((current) => current.workspace.read),
      save: targeted((current) => current.workspace.save),
      format: targeted((current) => current.workspace.format),
      search: targeted((current) => current.workspace.search),
      blame: targeted((current) => current.workspace.blame),
      vcs: {
        snapshot: targeted((current) => current.workspace.vcs.snapshot),
        changes: targeted((current) => current.workspace.vcs.changes),
        diff: targeted((current) => current.workspace.vcs.diff),
        contents: targeted((current) => current.workspace.vcs.contents),
        log: targeted((current) => current.workspace.vcs.log),
        refs: targeted((current) => current.workspace.vcs.refs),
        stage: targeted((current) => current.workspace.vcs.stage),
        discard: targeted((current) => current.workspace.vcs.discard),
        commit: targeted((current) => current.workspace.vcs.commit),
        createBranch: targeted((current) => current.workspace.vcs.createBranch),
        push: targeted((current) => current.workspace.vcs.push),
      },
    },
    provider: {
      models: { default: call((current) => current.provider.models.default) },
    },
    plugins: {
      catalog: call((current) => current.plugins.catalog),
      list: call((current) => current.plugins.list),
      commands: {
        list: call((current) => current.plugins.commands.list),
        run: call((current) => current.plugins.commands.run),
      },
      settings: {
        list: call((current) => current.plugins.settings.list),
        apply: call((current) => current.plugins.settings.apply),
      },
      resources: { list: call((current) => current.plugins.resources.list) },
    },
    watch: (input, onEvent, onError) => {
      const controller = new AbortController();

      const run = async (): Promise<void> => {
        try {
          const current = await connected();

          for await (const event of current.watch({ ...input, signal: controller.signal })) {
            onEvent(event);
          }
        } catch (cause) {
          if (controller.signal.aborted) return;
          onError?.(cause instanceof Error ? cause : new Error(String(cause)));
        }
      };

      void run();

      return () => controller.abort();
    },
    host: {
      onMenuCommand: () => () => undefined,
      setThemePreference: () => undefined,
      state: async () => {
        if (registry !== undefined) return registry.state();
        const selection = await call((current) => current.workspace.current)();

        return {
          workspace: selection.kind === "home" ? undefined : selection.workspace,
          platform: browserPlatform(),
        };
      },
      sessionDirectory: () => directory.snapshot(),
      fonts: () => Promise.resolve({ sans: [], monospace: [] }),
      openWorkspace,
      get pickWorkspace() {
        const current = registry;

        if (current === undefined) return undefined;

        return async (): Promise<OpenWorkspaceOutcome> => {
          const path = await requestFolderPath(current.binding.hostId);

          if (path === undefined) return { kind: "cancelled" };

          return registry === current ? openOn(current, path) : CONNECTION_CHANGED;
        };
      },
      get trustWorkspace() {
        const current = registry;

        return current === undefined
          ? undefined
          : async (input: {
              path: string;
              consent?: TrustConsent;
            }): Promise<OpenWorkspaceOutcome> => {
              if (registry !== current) return CONNECTION_CHANGED;
              const outcome = await current.trust(input);
              refreshQuietly();

              return outcome;
            };
      },
      closeWorkspace: async () => {
        if (registry !== undefined) {
          registry.close();
          refreshQuietly();

          return;
        }

        const outcome = await select({ kind: "home" });

        if (outcome.kind === "failed") throw new Error(outcome.message);
      },
      get starts() {
        const current = registry;

        return current === undefined
          ? undefined
          : {
              ...current.starts,
              start: async (input: RootStartInput) => {
                const outcome = await current.starts.start(input);
                refreshQuietly();

                return outcome;
              },
              retry: async (requestId: string) => {
                const outcome = await current.starts.retry(requestId);
                refreshQuietly();

                return outcome;
              },
            };
      },
      catalog: async () => {
        const current = await connected();

        if (environment) return current.environment("environment.catalog", undefined);

        const [models, defaultModel] = await Promise.all([
          current.provider.models.list(),
          current.provider.models.default(),
        ]);

        return serverCatalog(models, defaultModel);
      },
      usage: (input) => environmentCall("environment.usage", input),
      accountLimits: () => environmentCall("environment.accountLimits", undefined),
      ...signIn,
      logout: async (input) => {
        await environmentCall("environment.logout", input);
        emit({ kind: "catalog_changed" });
      },
      setPreference: (change) => environmentCall("environment.setPreference", change),
      // Registry hosts serve no `environment.github.*`; only a cursor host's environment offers it.
      get github() {
        return environment && registry === undefined ? github : undefined;
      },
      server: {
        state: () => Promise.resolve({ kind: "none" }),
        connect: refuse(SERVER),
        disconnect: refuse(SERVER),
        createSession: refuse(SERVER),
      },
      remote: {
        state: () =>
          Promise.resolve({
            kind: "off",
            tailnet: { kind: "missing" },
            cloudflare: { kind: "unregistered" },
          }),
        start: refuse(REMOTE_ACCESS),
        stop: refuse(REMOTE_ACCESS),
        configure: refuse(REMOTE_ACCESS),
        clear: refuse(REMOTE_ACCESS),
        pair: refuse(REMOTE_ACCESS),
        revoke: refuse(REMOTE_ACCESS),
      },
      connect: {
        state: () => Promise.resolve({ kind: "unavailable", reason: "not_configured" }),
        link: refuse(REMOTE_ACCESS),
        cancel: refuse(REMOTE_ACCESS),
        setEnabled: refuse(REMOTE_ACCESS),
        unlink: refuse(REMOTE_ACCESS),
        revokeDevice: refuse(REMOTE_ACCESS),
        openAccount: refuse(REMOTE_ACCESS),
        signOut: refuse(REMOTE_ACCESS),
      },
      openExternal: async ({ url }) => {
        const page = webPageUrl(url);

        if (page === undefined) throw new Error("Only web pages open from the web app.");
        window.open(page, "_blank", "noopener");
      },
      confirmExternal: async ({ url }) =>
        window.confirm(`Open external website?\n\n${url}`) ? "open" : "cancel",
      pathForFile: () => "",
      onEvent: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    },
  };

  return {
    bridge,
    connect: async ({ url, token }, options) => {
      const verification = options?.signal ?? AbortSignal.timeout(10_000);
      let verifying = true;

      const next = createNyteClient({
        baseUrl: url,
        token,
        fetch: (resource, init) =>
          fetch(resource, {
            ...init,
            credentials: "omit",
            signal: verifying ? verification : init?.signal,
          }),
      });

      const info = await next.info();
      // The identity this browser binds selections, starts and queued messages to: the pin, or on
      // first pairing the one announced. Either way the host signs for it before anything is adopted.
      const proving = options?.identity ?? info.identity;

      if (proving !== undefined) {
        if (info.identity?.hostId !== proving.hostId) throw new IdentityChanged();
        const nonce = randomNonce();
        const challenge = await next.identity(nonce);

        if (!(await verifyIdentityChallenge({ challenge, pinned: proving, nonce })))
          throw new IdentityChanged();
      }

      if (verification.aborted) throw new Error("Connecting stopped.");
      verifying = false;
      // Rows queued for the host being left stop before the next one is adopted; they stay
      // stored under their own binding and send again only when that binding is active.
      deactivateOutbox();
      client = next;
      environment = info.environment;
      relay = options?.relay;
      registry =
        info.workspaces?.kind === "registry" && info.identity !== undefined
          ? createRegistryController({
              client: next,
              binding: { hostId: info.identity.hostId, principal: options?.principal ?? "bearer" },
              storage: sessionStorage,
              journal,
              platform: browserPlatform(),
              emit,
            })
          : undefined;
      directory.reset();
      void registry?.replay().then(refreshQuietly);

      if (!polling) {
        polling = true;
        setInterval(poll, REFRESH_MS);
        document.addEventListener("visibilitychange", poll);
      }

      return info;
    },
  };
}
