/**
 * The desktop host keeps workspace SDKs open independently. Selection chooses
 * the destination for new chats; session ids route existing chats to their
 * owning SDK. Runners attach per session, so switching folders preserves work. Every renderer request lands in `call` as a verb path plus
 * one input object — the SDK's own wire shape — and `watch` becomes a pump per
 * subscription that pushes events back over IPC.
 *
 * Electron specifics (windows, dialogs, shell) are injected, so this class
 * tests headless under Vitest.
 */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte, discoverMentionFiles, WorkspaceTrustRequired } from "@nyte-ai/core";
import type {
  ActiveSessionActivation,
  Disposer,
  SessionId,
  Nyte,
  WorkspaceInfo,
} from "@nyte-ai/core";
// Hosts name their storage backend through the store entry (design record,
// import rules), so the barrel cut will not touch this file.
import { SqliteStore } from "@nyte-ai/core/store";
import type {
  CallInput,
  CallOutput,
  CallPath,
  DesktopCatalog,
  HostEvent,
  HostState,
  GitHubProviderState,
  LocalFontCatalog,
  OpenWorkspaceOutcome,
  PreferenceChange,
  SdkVerbPath,
  WatchEnvelope,
  WatchStartInput,
  WorkspaceSessionDirectory,
} from "../shared/ipc.ts";
import { createNyteModels } from "@nyte-ai/ai";
import { loadPersistedCatalog, login, readCatalog } from "./catalog.ts";
import type { ResolvedCatalog } from "./catalog.ts";
import { safeExternalUrl } from "./external-url.ts";
import type { BrowserSurfaces } from "./browser.ts";
import { TerminalSessions } from "./terminals.ts";
import { createGitHubProvider, type GitHubProvider } from "./github.ts";
import { CALL_INPUT_SCHEMAS, sdkVerb, type SdkVerb } from "./ipc-inputs.ts";
import { resolveDesktopPlugins, type DesktopPluginTarget } from "./plugins.ts";
import { createGitVcs } from "./vcs.ts";
import type { DesktopGitVcs } from "./vcs.ts";
import {
  createModelPreferencesStore,
  createTrustStore,
  createWorkspaceRegistry,
  nyteHome,
  projectSessionPath,
} from "./workspaces.ts";

export interface DesktopHostDependencies {
  /** Push a host event to the focused window; dropped when none is open. */
  emitHostEvent(event: HostEvent): void;
  /** Push one watch envelope to the subscribing window. */
  emitWatchEvent(envelope: WatchEnvelope): void;
  openExternal(url: string): void;
  browser: BrowserSurfaces;
  listFonts(): Promise<LocalFontCatalog>;
  /** Native folder picker; resolves undefined on cancel. */
  pickFolder(): Promise<string | undefined>;
}

interface OpenTargetBase {
  readonly sdk: Nyte;
  readonly store: SqliteStore;
  readonly sessionAttachments: Map<SessionId, Disposer>;
}

interface OpenHomeTarget extends OpenTargetBase {
  readonly kind: "home";
}

interface OpenProjectTarget extends OpenTargetBase {
  readonly kind: "project";
  readonly workspace: WorkspaceInfo;
  readonly vcs: DesktopGitVcs;
  readonly github: () => Promise<GitHubProvider>;
}

type OpenTarget = OpenHomeTarget | OpenProjectTarget;

type WorkspaceTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: WorkspaceInfo };

/** Each closure decodes before acquiring the open workspace. */
const SDK_DISPATCH = {
  "sessions.create": sdkVerb(CALL_INPUT_SCHEMAS["sessions.create"], (sdk, input) =>
    sdk.sessions.create(input),
  ),
  "sessions.get": sdkVerb(CALL_INPUT_SCHEMAS["sessions.get"], (sdk, input) =>
    sdk.sessions.get(input),
  ),
  "sessions.snapshot": sdkVerb(CALL_INPUT_SCHEMAS["sessions.snapshot"], (sdk, input) =>
    sdk.sessions.snapshot(input),
  ),
  "sessions.list": sdkVerb(CALL_INPUT_SCHEMAS["sessions.list"], (sdk, input) =>
    sdk.sessions.list(input),
  ),
  "sessions.rename": sdkVerb(CALL_INPUT_SCHEMAS["sessions.rename"], (sdk, input) =>
    sdk.sessions.rename(input),
  ),
  "sessions.setPinned": sdkVerb(CALL_INPUT_SCHEMAS["sessions.setPinned"], (sdk, input) =>
    sdk.sessions.setPinned(input),
  ),
  "sessions.setArchived": sdkVerb(CALL_INPUT_SCHEMAS["sessions.setArchived"], (sdk, input) =>
    sdk.sessions.setArchived(input),
  ),
  "sessions.delete": sdkVerb(CALL_INPUT_SCHEMAS["sessions.delete"], (sdk, input) =>
    sdk.sessions.delete(input),
  ),
  "sessions.configure": sdkVerb(CALL_INPUT_SCHEMAS["sessions.configure"], (sdk, input) =>
    sdk.sessions.configure(input),
  ),
  "messages.send": sdkVerb(CALL_INPUT_SCHEMAS["messages.send"], (sdk, input) =>
    sdk.messages.send(input),
  ),
  "messages.cancel": sdkVerb(CALL_INPUT_SCHEMAS["messages.cancel"], (sdk, input) =>
    sdk.messages.cancel(input),
  ),
  "messages.redeliver": sdkVerb(CALL_INPUT_SCHEMAS["messages.redeliver"], (sdk, input) =>
    sdk.messages.redeliver(input),
  ),
  "runs.abort": sdkVerb(CALL_INPUT_SCHEMAS["runs.abort"], (sdk, input) => sdk.runs.abort(input)),
  "runs.changes": sdkVerb(CALL_INPUT_SCHEMAS["runs.changes"], (sdk, input) =>
    sdk.runs.changes(input),
  ),
  "heads.move": sdkVerb(CALL_INPUT_SCHEMAS["heads.move"], (sdk, input) => sdk.heads.move(input)),
  "workspace.vcs.diff": sdkVerb(CALL_INPUT_SCHEMAS["workspace.vcs.diff"], (sdk, input) =>
    sdk.workspace.vcs.diff(input),
  ),
  "provider.models.default": sdkVerb(CALL_INPUT_SCHEMAS["provider.models.default"], (sdk) =>
    sdk.provider.models.default(),
  ),
  "plugins.catalog": sdkVerb(CALL_INPUT_SCHEMAS["plugins.catalog"], (sdk) => sdk.plugins.catalog()),
  "plugins.list": sdkVerb(CALL_INPUT_SCHEMAS["plugins.list"], (sdk, input) =>
    sdk.plugins.list(input),
  ),
  "plugins.commands.list": sdkVerb(CALL_INPUT_SCHEMAS["plugins.commands.list"], (sdk, input) =>
    sdk.plugins.commands.list(input),
  ),
  "plugins.commands.run": sdkVerb(CALL_INPUT_SCHEMAS["plugins.commands.run"], (sdk, input) =>
    sdk.plugins.commands.run(input),
  ),
  "plugins.settings.list": sdkVerb(CALL_INPUT_SCHEMAS["plugins.settings.list"], (sdk, input) =>
    sdk.plugins.settings.list(input),
  ),
  "plugins.settings.apply": sdkVerb(CALL_INPUT_SCHEMAS["plugins.settings.apply"], (sdk, input) =>
    sdk.plugins.settings.apply(input),
  ),
  "plugins.resources.list": sdkVerb(CALL_INPUT_SCHEMAS["plugins.resources.list"], (sdk, input) =>
    sdk.plugins.resources.list(input),
  ),
} satisfies Record<Exclude<SdkVerbPath, RegistryVerbPath>, SdkVerb>;

/** Registry verbs answer with no workspace open, so they bypass SDK preparation. */
type RegistryVerbPath = "workspace.list" | "workspace.forget";

function isSdkVerb(path: CallPath): path is Exclude<SdkVerbPath, RegistryVerbPath> {
  // hasOwn, not `in`: the path is renderer input and must never walk the prototype chain.
  return Object.hasOwn(SDK_DISPATCH, path);
}

export class DesktopHost {
  private readonly dependencies: DesktopHostDependencies;
  private readonly trustStore = createTrustStore();
  private readonly registry = createWorkspaceRegistry();
  private readonly preferences = createModelPreferencesStore();
  private modelsPromise: Promise<MutableModels> | undefined;
  private target: WorkspaceTarget = { kind: "home" };
  private open: OpenTarget | undefined;
  private readonly openTargets = new Map<string | null, OpenTarget>();
  private readonly sessionOwners = new Map<SessionId, OpenTarget>();
  private lifecycle: Promise<void> = Promise.resolve();
  private readonly watches = new Map<string, AbortController>();
  private closed = false;
  private readonly trustPrompts = new Set<string>();
  private terminalsPromise: Promise<TerminalSessions> | undefined;
  private terminalGeneration = 0;

  constructor(dependencies: DesktopHostDependencies) {
    this.dependencies = dependencies;
  }

  /** The one renderer entry point: a verb path and its single input object. */
  call<P extends CallPath>(path: P, input: CallInput<P>): Promise<CallOutput<P>>;
  async call(path: CallPath, input: CallInput<CallPath>): Promise<CallOutput<CallPath>> {
    // The registry answers before any workspace is open, so the rail's recents
    // speak the same verb the SDK defines.
    if (path === "workspace.list") {
      CALL_INPUT_SCHEMAS[path].Parse(input);
      return this.registry.list();
    }
    if (path === "workspace.forget") {
      return this.forgetWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
    }
    // The model catalog is user-scoped. Reading its fallback must not force a
    // directory choice just so the blank composer can render truthfully.
    if (path === "provider.models.default") {
      CALL_INPUT_SCHEMAS[path].Parse(input);
      const { defaultModel: model } = await this.catalog();
      return {
        id: model.id,
        provider: model.provider,
        name: model.name,
        contextWindow: model.contextWindow,
      };
    }
    if (path === "sessions.create") {
      const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
      const open = await this.prepare();
      const session = await open.sdk.sessions.create(decoded);
      this.sessionOwners.set(session.sessionId, open);
      return session;
    }
    if (path === "sessions.list") {
      const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
      const owner = decoded?.parent == null ? undefined : this.sessionOwners.get(decoded.parent);
      const open = owner ?? (await this.prepare());
      const page = await open.sdk.sessions.list(decoded);
      for (const session of page.items) this.sessionOwners.set(session.sessionId, open);
      return page;
    }
    if (path === "messages.send") {
      const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
      const open = this.sessionOwners.get(decoded.sessionId) ?? (await this.prepare());
      if (open.kind === "project") {
        await this.trustStore.require(open.workspace.path).catch((cause: unknown) => {
          const key = decoded.key ?? decoded.sessionId;
          if (cause instanceof WorkspaceTrustRequired && !this.trustPrompts.has(key)) {
            this.trustPrompts.add(key);
            this.dependencies.emitHostEvent({ kind: "workspace_trust_required", path: cause.cwd });
          }
          throw cause;
        });
      }
      this.attachSession(open, decoded.sessionId);
      return SDK_DISPATCH[path].invoke(decoded, () => Promise.resolve(open.sdk));
    }
    if (isSdkVerb(path)) {
      const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
      const sessionId =
        decoded !== undefined && "sessionId" in decoded ? decoded.sessionId : undefined;
      const owner = sessionId === undefined ? undefined : this.sessionOwners.get(sessionId);
      const open = owner ?? (await this.prepare());
      return SDK_DISPATCH[path].invoke(decoded, () => Promise.resolve(open.sdk));
    }
    switch (path) {
      case "host.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.state();
      case "host.sessionDirectory":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.sessionDirectory();
      case "host.fonts":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.dependencies.listFonts();
      case "host.openWorkspace":
        return this.openWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.pickWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.pickWorkspace();
      case "host.trustWorkspace":
        return this.trustWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.closeWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.closeWorkspace();
      case "host.catalog":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return (await this.catalog()).catalog;
      case "host.login": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.login(decoded.provider, decoded.method);
      }
      case "host.logout":
        return this.logout(CALL_INPUT_SCHEMAS[path].Parse(input).provider);
      case "host.setPreference":
        return this.setPreference(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.vcs.snapshot":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.requireProject().vcs.snapshot();
      case "host.files.list":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return discoverMentionFiles(this.requireProject().workspace.path);
      case "host.github.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return (await this.requireProject().github()).state();
      case "host.github.refresh":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return (await this.requireProject().github()).state(true);
      case "host.github.signIn":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.changeGitHubAuth("signIn");
      case "host.github.signOut":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.changeGitHubAuth("signOut");
      case "host.openExternal": {
        const { url } = CALL_INPUT_SCHEMAS[path].Parse(input);
        this.dependencies.openExternal(safeExternalUrl(url));
        return undefined;
      }
      case "host.browser.open":
        return this.dependencies.browser.open(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.navigate":
        this.dependencies.browser.navigate(CALL_INPUT_SCHEMAS[path].Parse(input));
        return undefined;
      case "host.browser.menu":
        return this.dependencies.browser.menu(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.perform":
        return this.dependencies.browser.perform(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.close":
        this.dependencies.browser.close(CALL_INPUT_SCHEMAS[path].Parse(input));
        return undefined;
      case "host.terminal.create": {
        const generation = this.terminalGeneration;
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const cwd = decoded.workspacePath ?? homedir();
        if (decoded.workspacePath !== null) {
          if (this.requireProject().workspace.path !== decoded.workspacePath) {
            throw new Error("Open this workspace before starting a terminal");
          }
          await this.trustStore.require(cwd).catch((cause: unknown) => {
            if (cause instanceof WorkspaceTrustRequired) {
              this.dependencies.emitHostEvent({
                kind: "workspace_trust_required",
                path: cause.cwd,
              });
            }
            throw cause;
          });
        }
        const terminals = await this.terminals();
        if (this.closed || generation !== this.terminalGeneration)
          throw new Error("Terminal window closed");
        return terminals.create({ id: decoded.id, cwd });
      }
      case "host.terminal.write":
        return (await this.terminals()).write(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.resize":
        return (await this.terminals()).resize(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.acknowledge":
        return (await this.terminals()).acknowledge(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.close":
        return (await this.terminals()).close(CALL_INPUT_SCHEMAS[path].Parse(input));
      default:
        path satisfies never;
        throw new Error("Unknown verb");
    }
  }

  watchStart(input: WatchStartInput): void {
    if (this.watches.has(input.watchId)) throw new Error(`Watch already exists: ${input.watchId}`);
    const stop = new AbortController();
    this.watches.set(input.watchId, stop);
    void (async () => {
      try {
        const open = this.sessionOwners.get(input.sessionId) ?? (await this.prepare());
        if (stop.signal.aborted) return;
        this.attachSession(open, input.sessionId);
        const source =
          input.live === true
            ? open.sdk.watch({ sessionId: input.sessionId, live: true, signal: stop.signal })
            : input.afterSeq === undefined
              ? open.sdk.watch({ sessionId: input.sessionId, signal: stop.signal })
              : open.sdk.watch({
                  sessionId: input.sessionId,
                  afterSeq: input.afterSeq,
                  signal: stop.signal,
                });
        for await (const event of source) {
          if (stop.signal.aborted) return;
          this.dependencies.emitWatchEvent({ watchId: input.watchId, kind: "event", event });
        }
        if (!stop.signal.aborted) {
          this.dependencies.emitWatchEvent({ watchId: input.watchId, kind: "ended" });
        }
      } catch (cause) {
        if (!stop.signal.aborted) {
          this.dependencies.emitWatchEvent({
            watchId: input.watchId,
            kind: "ended",
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      } finally {
        this.watches.delete(input.watchId);
      }
    })();
  }

  watchStop(watchId: string): void {
    this.watches.get(watchId)?.abort();
    this.watches.delete(watchId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeTerminals();
    await this.serialize(() => this.teardownOpen());
  }

  async closeTerminals(): Promise<void> {
    this.terminalGeneration += 1;
    const pending = this.terminalsPromise;
    this.terminalsPromise = undefined;
    if (pending !== undefined) (await pending).dispose();
  }

  private terminals(): Promise<TerminalSessions> {
    this.terminalsPromise ??= Promise.resolve(
      new TerminalSessions((event) => this.dependencies.emitHostEvent(event)),
    );
    return this.terminalsPromise;
  }

  private state(): HostState {
    return {
      workspace: this.open?.kind === "project" ? this.open.workspace : undefined,
      platform: process.platform,
    };
  }

  private requireProject(): OpenProjectTarget {
    const open = this.open;
    if (open?.kind !== "project") throw new Error("No project is open");
    return open;
  }

  /** Prepare local storage while Chromium starts; IPC joins the same initialization. */
  prepare(): Promise<OpenTarget> {
    if (this.open !== undefined) return Promise.resolve(this.open);
    return this.serialize(async () => {
      if (this.open !== undefined) return this.open;
      const open = await this.compose(this.target);
      this.open = open;
      return open;
    });
  }

  private attachSession(open: OpenTarget, sessionId: SessionId): void {
    if (open.sessionAttachments.has(sessionId)) return;
    open.sessionAttachments.set(sessionId, open.sdk.attach({ sessions: [sessionId] }));
  }

  private models(): Promise<MutableModels> {
    this.modelsPromise ??= (async () => {
      const models = createNyteModels();
      await loadPersistedCatalog(models);
      return models;
    })();
    return this.modelsPromise;
  }

  private async catalog(): Promise<ResolvedCatalog> {
    return readCatalog(await this.models(), await this.preferences.read());
  }

  /** Serialize workspace lifecycle so a double-click cannot compose twice. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async pickWorkspace(): Promise<OpenWorkspaceOutcome> {
    const path = await this.dependencies.pickFolder();
    if (path === undefined) return { kind: "cancelled" };
    return this.openWorkspace(path);
  }

  private trustWorkspace(path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize<OpenWorkspaceOutcome>(async () => {
      await this.trustStore.trust(path);
      this.trustPrompts.clear();
      // The outbox retries the pending send without changing the selected session.
      return { kind: "cancelled" };
    }).catch((cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }));
  }

  private openWorkspace(path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize(() => this.selectProject(path)).catch((cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: cause instanceof Error ? cause.message : String(cause),
    }));
  }

  /** Selection opens local history. Core resolves the execution path when sending. */
  private async selectProject(path: string): Promise<OpenWorkspaceOutcome> {
    const cwd = await realpath(resolve(path)).catch(() => resolve(path));
    if (this.open?.kind === "project" && this.open.workspace.path === cwd) {
      return { kind: "opened", workspace: this.open.workspace };
    }
    await this.registry.touch(cwd);
    const workspace = (await this.registry.list()).find((entry) => entry.path === cwd);
    if (workspace === undefined) throw new Error(`Workspace was not recorded: ${cwd}`);
    const target = { kind: "project", workspace } as const;
    // Keep the current session open if local storage cannot be composed.
    const open = await this.compose(target);
    this.target = target;
    this.trustPrompts.clear();
    this.open = open;
    this.dependencies.emitHostEvent({ kind: "workspace_opened", workspace: open.workspace });
    return { kind: "opened", workspace: open.workspace };
  }

  /** Compose storage now; resolve directories and plugins only when a session activates. */
  private compose(target: { readonly kind: "home" }): Promise<OpenHomeTarget>;
  private compose(target: {
    readonly kind: "project";
    readonly workspace: WorkspaceInfo;
  }): Promise<OpenProjectTarget>;
  private compose(target: WorkspaceTarget): Promise<OpenTarget>;
  private async compose(target: WorkspaceTarget): Promise<OpenTarget> {
    const key = target.kind === "home" ? null : target.workspace.path;
    const existing = this.openTargets.get(key);
    if (existing !== undefined) return existing;
    const models = await this.models();
    const { catalog, defaultModel: fallback } = await this.catalog();
    const projectCwd = target.kind === "project" ? target.workspace.path : undefined;
    const store = new SqliteStore(
      projectCwd === undefined
        ? join(nyteHome(), "sessions.db")
        : await projectSessionPath(projectCwd),
    );
    const vcs = projectCwd === undefined ? undefined : createGitVcs(projectCwd);
    let githubPromise: Promise<GitHubProvider> | undefined;
    const github = (): Promise<GitHubProvider> => {
      if (projectCwd === undefined) throw new Error("No project is open");
      githubPromise ??= Promise.resolve(createGitHubProvider(projectCwd));
      return githubPromise;
    };
    let activationPromise: Promise<ActiveSessionActivation> | undefined;
    let sdk: Nyte | undefined;
    try {
      sdk = await createNyte({
        store,
        streamFn: (model, context, streamOptions) =>
          models.streamSimple(model, context, streamOptions),
        models,
        model: fallback,
        thinkingLevel: catalog.defaults.thinkingLevel,
        vcs,
        workspaces: this.registry,
        resolveActivation: () => {
          activationPromise ??= (async (): Promise<ActiveSessionActivation> => {
            const pluginTarget: DesktopPluginTarget =
              target.kind === "project"
                ? {
                    kind: "project",
                    workspace: await this.trustStore.require(target.workspace.path),
                  }
                : { kind: "home" };
            const cwd =
              pluginTarget.kind === "project"
                ? pluginTarget.workspace.cwd
                : await realpath(resolve(homedir()));
            const resolvedPlugins = await resolveDesktopPlugins(pluginTarget, {
              model: fallback,
              models,
            });
            for (const failure of resolvedPlugins.failures) {
              this.dependencies.emitHostEvent({
                kind: "status",
                message: `plugin ${failure.path}: ${failure.error}`,
              });
            }
            return { kind: "active", plugins: resolvedPlugins.plugins, env: { cwd } };
          })().catch((cause: unknown) => {
            activationPromise = undefined;
            throw cause;
          });
          return activationPromise;
        },
      });
      const base = { sdk, store, sessionAttachments: new Map<SessionId, Disposer>() };
      if (target.kind === "home") {
        const open = { ...base, kind: "home" } satisfies OpenHomeTarget;
        this.openTargets.set(null, open);
        return open;
      }
      if (vcs === undefined) throw new Error("Project VCS was not composed");
      const open = {
        ...base,
        kind: "project",
        workspace: target.workspace,
        vcs,
        github,
      } satisfies OpenProjectTarget;
      this.openTargets.set(target.workspace.path, open);
      return open;
    } catch (error) {
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  /** Drop a workspace from the rail. Forgetting the selected one returns the view to Home. */
  private async forgetWorkspace(path: string): Promise<void> {
    await this.registry.forget(path);
    if (this.open?.kind !== "project") return;
    const target = await realpath(resolve(path)).catch(() => resolve(path));
    if (this.open.workspace.path === target) await this.closeWorkspace();
  }

  private closeWorkspace(): Promise<void> {
    return this.serialize(async () => {
      this.open = await this.compose({ kind: "home" });
      this.target = { kind: "home" };
      this.dependencies.emitHostEvent({ kind: "workspace_closed" });
    });
  }

  /** Read every folder without selecting it or stopping another folder's work. */
  private sessionDirectory(): Promise<readonly WorkspaceSessionDirectory[]> {
    return this.serialize(async () => {
      const workspaces = await this.registry.list();
      const targets: WorkspaceTarget[] = [
        { kind: "home" },
        ...workspaces.map(
          (workspace) => ({ kind: "project", workspace }) satisfies WorkspaceTarget,
        ),
      ];
      return Promise.all(
        targets.map(async (target): Promise<WorkspaceSessionDirectory> => {
          const open = await this.compose(target);
          const { items } = await open.sdk.sessions.list({ includeArchived: true });
          for (const session of items) this.sessionOwners.set(session.sessionId, open);
          return {
            workspacePath: target.kind === "home" ? null : target.workspace.path,
            sessions: items,
          };
        }),
      );
    });
  }

  private async teardownOpen(): Promise<void> {
    this.open = undefined;
    for (const stop of this.watches.values()) stop.abort();
    this.watches.clear();
    this.sessionOwners.clear();
    for (const open of this.openTargets.values()) {
      for (const detach of open.sessionAttachments.values()) detach();
      open.sessionAttachments.clear();
      await open.sdk.close().catch(() => undefined);
      await open.store.close().catch(() => undefined);
    }
    this.openTargets.clear();
  }

  private async login(
    provider: string,
    method: { kind: "browser" } | { kind: "api_key"; key: string },
  ): Promise<void> {
    await login(await this.models(), provider, method, {
      openExternal: (url) => this.dependencies.openExternal(url),
      notifyStatus: (message) => this.dependencies.emitHostEvent({ kind: "status", message }),
    });
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
  }

  private async logout(provider: string): Promise<void> {
    await (await this.models()).logout(provider);
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
  }

  private async setPreference(change: PreferenceChange): Promise<DesktopCatalog> {
    const preferences = await this.preferences.update(change);
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
    return (await readCatalog(await this.models(), preferences)).catalog;
  }

  private async changeGitHubAuth(verb: "signIn" | "signOut"): Promise<GitHubProviderState> {
    const state = await (await this.requireProject().github())[verb]();
    this.dependencies.emitHostEvent({ kind: "github_changed" });
    return state;
  }
}
