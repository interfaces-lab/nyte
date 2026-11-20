import type { ClientApi, Connection, PluginApi, PluginStorage } from "@nyte-ai/core";

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

export function clientApi(
  sdk: Connection,
  notified: Parameters<ClientApi["ui"]["notify"]>[0][],
): PluginApi<"client"> {
  return {
    side: "client",
    host: sdk,
    registries: {
      commands: { list: () => [] },
      settings: {
        list: () => [],
        value: async () => undefined,
        set: async () => undefined,
        watch: async function* () {},
      },
      renderers: { list: () => [] },
      keybindings: { list: () => [] },
    },
    storage,
    signal: new AbortController().signal,
    report: () => undefined,
    reload: () => undefined,
    client: { name: "test", frameworks: ["react", "tui"] },
    session: null,
    looking: new Set(),
    ui: { notify: (input) => notified.push(input) },
  };
}
