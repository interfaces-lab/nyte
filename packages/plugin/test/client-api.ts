import type { ClientApi, Connection, PluginApi, PluginStorage, Setting } from "@nyte-ai/core";

/** A plugin storage that keeps nothing. */
const storage: PluginStorage = {
  get: async () => undefined,
  set: async () => undefined,
  delete: async () => undefined,
  keys: async () => [],
  at: () => storage,
  secrets: {
    get: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
  },
};

/** Returns a client plugin api over `sdk` whose notifications land in `notified` and whose registries hold nothing. */
export function clientApi(
  sdk: Connection,
  notified: Parameters<ClientApi["ui"]["notify"]>[0][],
): PluginApi<"client"> {
  const setting: Setting & (() => void) = Object.assign(() => undefined, {
    get: async () => undefined,
    set: async () => undefined,
    watch: async function* () {},
  });

  return {
    side: "client",
    sdk,
    contribute: {
      commands: { add: () => () => undefined, list: () => [] },
      settings: {
        add: () => setting,
        list: () => [],
        value: async () => undefined,
        watch: async function* () {},
      },
      renderers: { add: () => () => undefined, list: () => [] },
      keybindings: { add: () => () => undefined, list: () => [] },
    },
    storage,
    signal: new AbortController().signal,
    hook: () => () => undefined,
    report: () => undefined,
    reload: () => undefined,
    client: { name: "test", frameworks: ["react", "tui"] },
    session: null,
    ui: { notify: (input) => notified.push(input) },
  };
}
