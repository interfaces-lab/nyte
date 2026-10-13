/**
 * The terminal's client plugin mount: each plugin activated once per app with
 * a client `PluginApi`, its renderers for the `tui` framework collected by
 * part kind, and the client hooks dispatched by the shell. Run ends anywhere
 * are read from the session directory as it changes.
 */
import type {
  Command,
  HookEntry,
  HookHandler,
  HookName,
  Keybinding,
  Plugin,
  PluginApi,
  Renderer,
  SettingDefinition,
} from "@nyte-ai/plugin/client";
import type {
  Connection,
  Decision,
  Disposer,
  Json,
  PluginStorage,
  Registry,
  RegistryDraft,
  Session,
  SessionId,
  Setting,
  SubmitDraft,
  ValidationIssue,
} from "@nyte-ai/sdk";
import { follow } from "../lib/view-helpers.ts";
import type { PartMessage } from "../lib/view-helpers.ts";

/** What a notification a plugin raises carries. */
type Notification = Parameters<PluginApi["ui"]["notify"]>[0];

type ClientRegistries = PluginApi["contribute"];

/** A derivation a registry runs at each read: what `add` takes besides an item. */
type Derive<T> = (draft: RegistryDraft<T>, siblings: ClientRegistries) => void;

/** One registered handler, in the order hooks run: ascending order, then registration. */
type Handlers = {
  [N in HookName]: {
    readonly order: number;
    readonly run: HookHandler<N>;
    readonly api: PluginApi;
  }[];
};

interface MountOptions {
  readonly connection: Connection;
  readonly plugins: readonly Plugin[];
  /** The session on screen, or null before one opens. */
  readonly session: () => Session | null;
  readonly notify: (input: Notification) => void;
  /** An issue a plugin reported, or a hook that threw. */
  readonly report: (plugin: string, message: string) => void;
}

/** The mounted plugins: their renderers, the hooks the shell fires, and teardown. */
export interface ClientPlugins {
  /** Returns the view a plugin's renderer draws for a part, or undefined when none draws its kind. */
  draw(message: PartMessage): unknown;
  /** The plugins mounted, for `/plugins`. */
  readonly ids: readonly string[];
  /** Runs `session_closed` for the old session and `session_opened` for the new one. */
  switched(previous: Session | null, next: Session): Promise<void>;
  /** Runs `before_submit` over a draft; the first verdict that is not continue wins. */
  beforeSubmit(draft: SubmitDraft): Promise<Decision<SubmitDraft>>;
  /** Runs `app_closing`, then deactivates every plugin. */
  dispose(): Promise<void>;
}

/** Returns a registry over static items and derivations; `list` runs the derivations over a fresh draft. */
function registry<T>(
  key: (item: T) => string,
  isItem: (entry: T | Derive<T>) => entry is T,
  siblings: () => ClientRegistries,
): Registry<T, "client"> {
  const items = new Set<T>();
  const derives = new Set<Derive<T>>();

  function add(item: T): Disposer;
  function add(derive: Derive<T>): Disposer;
  function add(entry: T | Derive<T>): Disposer {
    if (isItem(entry)) {
      items.add(entry);

      return () => void items.delete(entry);
    }

    derives.add(entry);

    return () => void derives.delete(entry);
  }

  return {
    add,
    list() {
      const draft = new Map<string, T>([...items].map((item) => [key(item), item]));

      for (const derive of derives)
        derive(
          {
            set: (id, item) => void draft.set(id, item),
            get: (id) => draft.get(id),
            delete: (id) => void draft.delete(id),
            ids: () => [...draft.keys()],
            wrap: (id, wrap) => {
              const inner = draft.get(id);

              if (inner !== undefined) draft.set(id, wrap(inner));
            },
          },
          siblings(),
        );

      return [...draft.values()];
    },
  };
}

/** Returns a plugin's settings registry; values live in memory for this app. */
function settingsRegistry(siblings: () => ClientRegistries): ClientRegistries["settings"] {
  const base = registry<SettingDefinition>(
    (item) => item.id,
    (entry): entry is SettingDefinition => typeof entry !== "function",
    siblings,
  );

  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  const current = (id: string): unknown => {
    const definition = base.list().find((item) => item.id === id);

    if (definition === undefined) throw new Error(`No setting is declared with id ${id}.`);

    return values.has(id) ? values.get(id) : definition.default;
  };

  async function* watch(id: string): AsyncIterable<unknown> {
    let pending = Promise.withResolvers<unknown>();
    const listener = (value: unknown): void => pending.resolve(value);
    const set = listeners.get(id) ?? new Set();
    set.add(listener);
    listeners.set(id, set);

    try {
      yield current(id);

      for (;;) {
        const value = await pending.promise;
        pending = Promise.withResolvers();
        yield value;
      }
    } finally {
      set.delete(listener);
    }
  }

  function add(item: SettingDefinition): Setting & Disposer;
  function add(derive: Derive<SettingDefinition>): Disposer;
  function add(entry: SettingDefinition | Derive<SettingDefinition>) {
    if (typeof entry === "function") return base.add(entry);
    const remove = base.add(entry);

    return Object.assign(remove, {
      get: async () => current(entry.id),
      set: async (value: unknown) => {
        values.set(entry.id, value);

        for (const listener of listeners.get(entry.id) ?? []) listener(value);
      },
      watch: () => watch(entry.id),
    });
  }

  return {
    add,
    list: () => base.list(),
    value: async (id) => current(id),
    watch,
  };
}

/** Returns storage that lives as long as this app; every scope is the same map, and secrets are refused. */
function memoryStorage(): PluginStorage {
  const values = new Map<string, Json>();

  function get<T extends Json>(key: string): Promise<T | undefined>;
  async function get(key: string): Promise<Json | undefined> {
    return values.get(key);
  }

  const storage: PluginStorage = {
    get,
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
    async keys() {
      return [...values.keys()];
    },
    at: () => storage,
    secrets: {
      get: async () => undefined,
      set: async () => {
        throw new Error("The terminal keeps no client secrets.");
      },
      delete: async () => undefined,
    },
  };

  return storage;
}

/**
 * Mounts client plugins: declared hooks and contributions first, then each
 * `activate`, then `app_ready`. Renderers for the `tui` framework draw the
 * part kinds they name; the first plugin to name a kind wins.
 */
export async function mountClientPlugins(options: MountOptions): Promise<ClientPlugins> {
  const handlers: Handlers = {
    run_ended_anywhere: [],
    app_ready: [],
    session_opened: [],
    before_submit: [],
    session_closed: [],
    app_closing: [],
  };

  const controller = new AbortController();
  const apis: { readonly plugin: Plugin; readonly api: PluginApi }[] = [];

  const register = <N extends HookName>(api: PluginApi, name: N, entry: HookEntry<N>): Disposer => {
    const handler =
      typeof entry === "function"
        ? { order: 0, run: entry, api }
        : { order: entry.order ?? 0, run: entry.run, api };

    const list: {
      readonly order: number;
      readonly run: HookHandler<N>;
      readonly api: PluginApi;
    }[] = handlers[name];

    list.push(handler);
    list.sort((left, right) => left.order - right.order);

    return () => {
      const index = list.indexOf(handler);

      if (index !== -1) list.splice(index, 1);
    };
  };

  const context = (api: PluginApi, session: SessionId | null) => ({
    api,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    session,
    head: null,
    run: null,
  });

  const observe = async <E>(
    list: readonly {
      readonly run: (event: E, ctx: ReturnType<typeof context>) => unknown;
      readonly api: PluginApi;
    }[],
    event: E,
    session: SessionId | null,
  ): Promise<void> => {
    for (const handler of list) {
      try {
        await handler.run(event, context(handler.api, session));
      } catch (cause) {
        options.report(
          apis.find((entry) => entry.api === handler.api)?.plugin.id ?? "plugin",
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    }
  };

  for (const plugin of options.plugins) {
    const registries: ClientRegistries = {
      commands: registry<Command>(
        (item) => item.name,
        (entry): entry is Command => typeof entry !== "function",
        () => registries,
      ),
      settings: settingsRegistry(() => registries),
      renderers: registry<Renderer>(
        (item) => `${item.kind.kind}:${item.framework}`,
        (entry): entry is Renderer => typeof entry !== "function",
        () => registries,
      ),
      keybindings: registry<Keybinding>(
        (item) => item.key,
        (entry): entry is Keybinding => typeof entry !== "function",
        () => registries,
      ),
    };

    for (const command of plugin.contribute?.commands ?? []) registries.commands.add(command);

    for (const setting of plugin.contribute?.settings ?? []) registries.settings.add(setting);

    for (const renderer of plugin.contribute?.renderers ?? []) registries.renderers.add(renderer);

    for (const binding of plugin.contribute?.keybindings ?? []) registries.keybindings.add(binding);

    const api: PluginApi = {
      side: "client",
      sdk: options.connection,
      contribute: registries,
      storage: memoryStorage(),
      signal: controller.signal,
      hook: (name, entry) => register(api, name, entry),
      report: (issue: ValidationIssue) => options.report(plugin.id, issue.message),
      reload: () => undefined,
      client: { name: "tui", frameworks: ["tui"] },
      get session() {
        return options.session();
      },
      ui: { notify: options.notify },
    };

    const hooks = plugin.hooks ?? {};

    if (hooks.run_ended_anywhere !== undefined)
      register(api, "run_ended_anywhere", hooks.run_ended_anywhere);

    if (hooks.app_ready !== undefined) register(api, "app_ready", hooks.app_ready);

    if (hooks.session_opened !== undefined) register(api, "session_opened", hooks.session_opened);

    if (hooks.before_submit !== undefined) register(api, "before_submit", hooks.before_submit);

    if (hooks.session_closed !== undefined) register(api, "session_closed", hooks.session_closed);

    if (hooks.app_closing !== undefined) register(api, "app_closing", hooks.app_closing);
    apis.push({ plugin, api });
  }

  for (const { plugin, api } of apis) {
    try {
      await plugin.activate?.(api);
    } catch (cause) {
      options.report(plugin.id, cause instanceof Error ? cause.message : String(cause));
    }
  }

  const renderers = new Map<string, Renderer>();

  for (const { api } of apis)
    for (const renderer of api.contribute.renderers.list())
      if (renderer.framework === "tui" && !renderers.has(renderer.kind.kind))
        renderers.set(renderer.kind.kind, renderer);

  const ends = new Map<string, string>();
  let seeded = false;

  const stopDirectory = follow(
    options.connection.sessions.watch({ parents: { kind: "all" } }),
    (sessions) => {
      for (const info of sessions) {
        for (const head of info.heads) {
          const key = `${info.id}/${head.name}`;
          const last = head.execution.kind === "idle" ? head.execution.lastRun : null;

          if (last === null || ends.get(key) === last.id) continue;
          ends.set(key, last.id);

          if (seeded)
            void observe(
              handlers.run_ended_anywhere,
              { session: info.id, run: last.id, end: last.end },
              info.id,
            );
        }
      }

      seeded = true;
    },
    (cause) =>
      options.report("notifications", cause instanceof Error ? cause.message : String(cause)),
  );

  await observe(handlers.app_ready, { restored: false }, null);

  return {
    ids: apis.map(({ plugin }) => plugin.id),
    draw(message) {
      const renderer = renderers.get(message.partKind);
      const session = options.session();

      if (renderer === undefined || session === null) return undefined;
      const part = session.part(message.part);

      return renderer.render(
        {
          state: message.state,
          version: message.version,
          placement: { kind: "transcript", role: message.role },
        },
        (action, input) => part.act(action, input),
      );
    },
    async switched(previous, next) {
      if (previous !== null)
        await observe(handlers.session_closed, { session: previous }, previous.id);
      await observe(handlers.session_opened, { session: next }, next.id);
    },
    async beforeSubmit(draft) {
      for (const handler of handlers.before_submit) {
        const decision = await handler.run(draft, context(handler.api, draft.session));

        if (decision.action !== "continue") return decision;
      }

      return { action: "continue" };
    },
    async dispose() {
      stopDirectory();
      await observe(handlers.app_closing, undefined, null);
      controller.abort();
    },
  };
}
