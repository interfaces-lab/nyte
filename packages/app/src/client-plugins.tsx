/**
 * The app's client plugins: the notifications plugin and the React renderers
 * from `@nyte-ai/plugin`, mounted once per app. Renderers draw the part kinds
 * the app has no view of its own for; a declared `run_ended_anywhere` fires
 * when a session's main head goes idle after a run, as the directory watch
 * shows. Hooks a plugin registers from `activate` are not run.
 */
import { isValidElement } from "react";
import type { ReactNode } from "react";
import notifications from "@nyte-ai/plugin/notifications";
import renderers from "@nyte-ai/plugin/renderers/react";
import type {
  HookEntry,
  HookHandler,
  HookName,
  Plugin,
  PluginApi,
  Renderer,
  SettingDefinition,
} from "@nyte-ai/plugin/client";
import type {
  Disposer,
  Json,
  PluginStorage,
  Registry,
  RegistryDraft,
  SessionId,
  SessionInfo,
  Setting,
} from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { connection } from "./sdk.tsx";
import type { PartMessage } from "./view-helpers.ts";

type ClientRegistries = PluginApi["contribute"];

type Derive<T> = (draft: RegistryDraft<T>, siblings: ClientRegistries) => void;

type RunEnded = Parameters<HookHandler<"run_ended_anywhere">>[0];

/** A registry over static items and derivations; `list` runs the derivations over a fresh draft. */
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

/** A plugin's settings registry; values live in memory for this app. */
function settingsRegistry(siblings: () => ClientRegistries): ClientRegistries["settings"] {
  const base = registry<SettingDefinition>(
    (item) => item.id,
    (entry): entry is SettingDefinition => typeof entry !== "function",
    siblings,
  );
  const values = new Map<string, unknown>();

  const value = async (id: string): Promise<unknown> => {
    const definition = base.list().find((item) => item.id === id);

    if (definition === undefined) throw new Error(`No setting is declared with id ${id}.`);

    return values.has(id) ? values.get(id) : definition.default;
  };

  function add(item: SettingDefinition): Setting<unknown> & Disposer;
  function add(derive: Derive<SettingDefinition>): Disposer;
  function add(entry: SettingDefinition | Derive<SettingDefinition>): Disposer {
    if (typeof entry === "function") return base.add(entry);
    const remove = base.add(entry);

    return Object.assign(remove, {
      get: () => value(entry.id),
      set: async (next: unknown) => void values.set(entry.id, next),
      watch: async function* () {
        yield await value(entry.id);
      },
    });
  }

  return {
    add,
    list: () => base.list(),
    value,
    watch: async function* (id) {
      yield await value(id);
    },
  };
}

/** A plugin's storage, in memory for this app. */
function memoryStorage(): PluginStorage {
  const values = new Map<string, Json>();

  /** A stored value is `Json`, returned as the `T` its writer stored, as core's storage does (§35g). */
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
        throw new Error("The app keeps no client secrets.");
      },
      delete: async () => undefined,
    },
  };

  return storage;
}

const plugins: readonly Plugin[] = [notifications, renderers];

const runEnded: { readonly run: HookHandler<"run_ended_anywhere">; readonly api: PluginApi }[] = [];

const drawers = new Map<string, Renderer>();

let mounted = false;

/** Mounts the client plugins once: declared contributions and hooks, then each `activate`. */
export function mountClientPlugins(session: () => SessionId | undefined): void {
  if (mounted) return;
  mounted = true;
  const controller = new AbortController();

  for (const plugin of plugins) {
    const contribute: ClientRegistries = {
      commands: registry(
        (item) => item.name,
        (entry) => typeof entry !== "function",
        () => contribute,
      ),
      settings: settingsRegistry(() => contribute),
      renderers: registry(
        (item) => item.kind.kind,
        (entry) => typeof entry !== "function",
        () => contribute,
      ),
      keybindings: registry(
        (item) => item.key,
        (entry) => typeof entry !== "function",
        () => contribute,
      ),
    };

    const api: PluginApi = {
      side: "client",
      sdk: connection(),
      contribute,
      storage: memoryStorage(),
      signal: controller.signal,
      hook:
        <N extends HookName>(_name: N, _entry: HookEntry<N>): Disposer =>
        () =>
          undefined,
      report: (issue) => toast.add({ type: "error", title: `${plugin.id}: ${issue.message}` }),
      reload: () => undefined,
      client: { name: "desktop", frameworks: ["react"] },
      get session() {
        const id = session();

        return id === undefined ? null : connection().session(id);
      },
      ui: {
        notify: (input) =>
          toast.add({
            type:
              input.level === "error" ? "error" : input.level === "warning" ? "warning" : "info",
            title: input.title ?? input.message,
            description: input.title === undefined ? undefined : input.message,
          }),
      },
    };

    for (const item of plugin.contribute?.renderers ?? []) contribute.renderers.add(item);

    const entry = plugin.hooks?.run_ended_anywhere;

    if (entry !== undefined)
      runEnded.push({ run: typeof entry === "function" ? entry : entry.run, api });
    void plugin.activate?.(api);

    for (const drawer of contribute.renderers.list())
      if (drawer.framework === "react" && !drawers.has(drawer.kind.kind))
        drawers.set(drawer.kind.kind, drawer);
  }
}

/** Fires `run_ended_anywhere` for each root's main head that went idle after a run since the last rows. */
export function observeRunEnds(
  previous: readonly SessionInfo[],
  next: readonly SessionInfo[],
): void {
  const before = new Map(previous.map((session) => [session.id, session.heads[0]?.execution]));

  for (const session of next) {
    const was = before.get(session.id);
    const now = session.heads[0]?.execution;

    if (was === undefined || was.kind === "idle" || now?.kind !== "idle" || now.lastRun === null)
      continue;
    const event: RunEnded = { session: session.id, run: now.lastRun.id, end: now.lastRun.end };

    for (const handler of runEnded) {
      void Promise.resolve(
        handler.run(event, {
          api: handler.api,
          signal: AbortSignal.timeout(5_000),
          session: session.id,
          head: null,
          run: now.lastRun.id,
        }),
      ).catch(() => undefined);
    }
  }
}

/** What a mounted renderer draws for a part, or null when none draws its kind. */
export function drawPart(
  sessionId: SessionId,
  message: PartMessage,
  placement: Parameters<Renderer["render"]>[0]["placement"],
): ReactNode {
  const drawer = drawers.get(message.partKind);

  if (drawer === undefined) return null;
  const drawn = drawer.render(
    { state: message.state, version: message.version, placement },
    (action, input) => connection().session(sessionId).part(message.part).act(action, input),
  );

  return isValidElement(drawn) ? drawn : null;
}
