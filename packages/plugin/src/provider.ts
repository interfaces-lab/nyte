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
  const enabled = async (api: SessionApi) => {
    const value = await api.storage.get("enabled");

    return value === "on" || (value !== "off" && (options.enabled ?? true));
  };

  return {
    id: options.id,
    provider: async (api) => ((await enabled(api)) ? options.provider : undefined),
    session(api) {
      api.settings.add((settings) =>
        settings.set(`${options.id}:enabled`, {
          label: `${options.provider.name} override`,
          key: "enabled",
          fallback: options.enabled === false ? "off" : "on",
          choices: [
            { id: "on", label: "on" },
            { id: "off", label: "off" },
          ],
        }),
      );
      api.commands.add((commands) =>
        commands.set(options.id, {
          description: `Toggle ${options.provider.name} override`,
          async run(argument) {
            const value = argument.trim();

            if (value !== "" && value !== "on" && value !== "off") {
              throw new Error(`Usage: /${options.id} [on|off]`);
            }

            const next = value === "" ? !(await enabled(api)) : value === "on";
            await api.storage.set("enabled", next ? "on" : "off");

            return `${options.provider.name} override: ${next ? "on" : "off"}`;
          },
        }),
      );
    },
  };
}
