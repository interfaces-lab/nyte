import type {
  Command,
  Connection,
  Keybinding,
  PluginStorage,
  Registry,
  RegistryDraft,
  Renderer,
  Session,
  Setting,
  SettingDefinition,
} from "@nyte-ai/core";
import type {
  Awaitable,
  Decision,
  Disposer,
  Json,
  Placement,
  RunId,
  SessionId,
  SessionInfo,
  SubmitDraft,
} from "@nyte-ai/schema";
import type { HookEntry, HookHandler, HookName, Plugin, PluginApi } from "../client.ts";
import type { PartMessage } from "./presentation.ts";

type Notification = Parameters<PluginApi["ui"]["notify"]>[0];

type ClientRegistries = PluginApi["contribute"];

type Derive<T> = (draft: RegistryDraft<T>, siblings: ClientRegistries) => void;

interface Handler<N extends HookName> {
  readonly order: number;
  readonly run: HookHandler<N>;
  readonly api: PluginApi;
}

type Handlers = { [N in HookName]: Handler<N>[] };

/**
 * What a client hands the plugins it mounts: its connection, the frameworks
 * it draws, the session on screen, and where notices and plugin errors go.
 *
 * @category plugins
 */
export interface MountOptions {
  readonly connection: Connection;
  readonly plugins: readonly Plugin[];
  readonly client: PluginApi["client"];
  readonly session: () => Session | null;
  readonly notify: (input: Notification) => void;
  readonly report: (plugin: string, message: string) => void;
}

/**
 * The mounted client plugins: their renderers and the hooks a client fires.
 *
 * @category plugins
 */
export interface ClientPlugins {
  readonly ids: readonly string[];
  /** The view a plugin renderer draws for a part, or undefined when none draws its kind. */
  draw(session: Session, message: PartMessage, placement: Placement): unknown;
  /** Feeds the session directory; each run that ends after the first list fires `run_ended_anywhere`. */
  sessionsChanged(sessions: readonly SessionInfo[]): void;
  switched(previous: Session | null, next: Session): Promise<void>;
  beforeSubmit(draft: SubmitDraft): Promise<Decision<SubmitDraft>>;
  dispose(): Promise<void>;
}

/** A derive is the only function a registry takes; every item is a plain record. */
function derives<T>(entry: T | Derive<T>): entry is Derive<T> {
  return typeof entry === "function";
}

function registry<T>(
  key: (item: T) => string,
  siblings: () => ClientRegistries,
): Registry<T, "client"> {
  const items = new Set<T>();
  const derivations = new Set<Derive<T>>();

  function add(item: T): Disposer;
  function add(derive: Derive<T>): Disposer;
  function add(entry: T | Derive<T>): Disposer {
    if (derives(entry)) {
      derivations.add(entry);

      return () => void derivations.delete(entry);
    }

    items.add(entry);

    return () => void items.delete(entry);
  }

  return {
    add,
    list() {
      const draft = new Map<string, T>([...items].map((item) => [key(item), item]));

      for (const derive of derivations)
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

function settingsRegistry(siblings: () => ClientRegistries): ClientRegistries["settings"] {
  const base = registry<SettingDefinition>((item) => item.id, siblings);
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
    if (derives(entry)) return base.add(entry);
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

  return { add, list: () => base.list(), value: async (id) => current(id), watch };
}

function memoryStorage(client: string): PluginStorage {
  const values = new Map<string, Json>();

  function get<T extends Json>(key: string): Promise<T | undefined>;
  async function get(key: string): Promise<Json | undefined> {
    return values.get(key);
  }

  const storage: PluginStorage = {
    get,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
    keys: async () => [...values.keys()],
    at: () => storage,
    secrets: {
      get: async () => undefined,
      set: async () => {
        throw new Error(`The ${client} client keeps no plugin secrets.`);
      },
      delete: async () => undefined,
    },
  };

  return storage;
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Activates client plugins once per app: their registries, hooks and the
 * first renderer per part kind among the frameworks the client draws.
 *
 * @category plugins
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
    const handler: Handler<N> =
      "run" in entry
        ? { order: entry.order ?? 0, run: entry.run, api }
        : { order: 0, run: entry, api };

    const list: Handler<N>[] = handlers[name];

    list.push(handler);
    list.sort((left, right) => left.order - right.order);

    return () => {
      const index = list.findIndex((candidate) => candidate === handler);

      if (index !== -1) list.splice(index, 1);
    };
  };

  const context = (api: PluginApi, session: SessionId | null, run: RunId | null) => ({
    api,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    session,
    head: null,
    run,
  });

  const reportFrom = (api: PluginApi, cause: unknown): void =>
    options.report(
      apis.find((entry) => entry.api === api)?.plugin.id ?? "plugin",
      causeMessage(cause),
    );

  const observe = async <E>(
    list: readonly {
      readonly run: (event: E, ctx: ReturnType<typeof context>) => Awaitable<void>;
      readonly api: PluginApi;
    }[],
    event: E,
    session: SessionId | null,
    run: RunId | null = null,
  ): Promise<void> => {
    for (const handler of list) {
      try {
        await handler.run(event, context(handler.api, session, run));
      } catch (cause) {
        reportFrom(handler.api, cause);
      }
    }
  };

  for (const plugin of options.plugins) {
    const registries: ClientRegistries = {
      commands: registry<Command>(
        (item) => item.name,
        () => registries,
      ),
      settings: settingsRegistry(() => registries),
      renderers: registry<Renderer>(
        (item) => `${item.kind.kind}:${item.framework}`,
        () => registries,
      ),
      keybindings: registry<Keybinding>(
        (item) => item.key,
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
      storage: memoryStorage(options.client.name),
      signal: controller.signal,
      hook: (name, entry) => register(api, name, entry),
      report: (issue) => options.report(plugin.id, issue.message),
      reload: () => undefined,
      client: options.client,
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
      options.report(plugin.id, causeMessage(cause));
    }
  }

  const renderers = new Map<string, Renderer>();

  for (const { api } of apis)
    for (const renderer of api.contribute.renderers.list())
      if (
        options.client.frameworks.includes(renderer.framework) &&
        !renderers.has(renderer.kind.kind)
      )
        renderers.set(renderer.kind.kind, renderer);

  const ends = new Map<string, RunId>();
  let seeded = false;

  await observe(handlers.app_ready, { restored: false }, null);

  return {
    ids: apis.map(({ plugin }) => plugin.id),
    draw(session, message, placement) {
      const renderer = renderers.get(message.partKind);

      if (renderer === undefined) return undefined;
      const part = session.part(message.part);

      return renderer.render(
        { state: message.state, version: message.version, placement },
        (action, input) => part.act(action, input),
      );
    },
    sessionsChanged(sessions) {
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
              last.id,
            );
        }
      }

      seeded = true;
    },
    async switched(previous, next) {
      if (previous !== null)
        await observe(handlers.session_closed, { session: previous }, previous.id);
      await observe(handlers.session_opened, { session: next }, next.id);
    },
    async beforeSubmit(draft) {
      for (const handler of handlers.before_submit) {
        const decision = await handler.run(draft, context(handler.api, draft.session, null));

        if (decision.action !== "continue") return decision;
      }

      return { action: "continue" };
    },
    async dispose() {
      await observe(handlers.app_closing, undefined, null);
      controller.abort();
    },
  };
}
