import type { Provider } from "@nyte-ai/ai";
import type { Plugin, SessionApi } from "@nyte-ai/core/plugins";

export interface ProviderPlugin extends Plugin {
  provider(api: SessionApi): Promise<Provider | undefined>;
}

export function isProviderPlugin(plugin: Plugin): plugin is ProviderPlugin {
  return "provider" in plugin && typeof plugin.provider === "function";
}

export function providerPlugin(options: {
  readonly id: string;
  readonly provider: Provider;
  readonly enabled?: boolean;
}): ProviderPlugin {
  // Setting ids are session-wide, so the plugin id keeps two overrides apart.
  const setting = `${options.id}:enabled`;
  const fallback = options.enabled === false ? "off" : "on";
  // `provider` is asked before `session` runs, so it reads the choice as the handle would.
  const enabled = async (api: SessionApi) => {
    const stored = await api.storage.get(setting);

    return (stored === "on" || stored === "off" ? stored : fallback) === "on";
  };

  return {
    id: options.id,
    provider: async (api) => ((await enabled(api)) ? options.provider : undefined),
    session(api) {
      const override = api.settings.add(setting, {
        label: `${options.provider.name} override`,
        default: fallback,
        choices: [
          { id: "on", label: "on" },
          { id: "off", label: "off" },
        ],
      });
      api.commands.add(options.id, {
        description: `Toggle ${options.provider.name} override`,
        selection: "run",
        async run(argument) {
          const value = argument.trim();

          if (value !== "" && value !== "on" && value !== "off") {
            throw new Error(`Usage: /${options.id} [on|off]`);
          }

          const next = value === "" ? !(await enabled(api)) : value === "on";
          await override.set(next ? "on" : "off");

          return `${options.provider.name} override: ${next ? "on" : "off"}`;
        },
      });
    },
  };
}
