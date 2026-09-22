/**
 * Fast inference as session policy. A host supplies its selected model, then
 * the plugin contributes provider-scoped fast-mode settings and patches only
 * requests whose resolved model advertises the mode. `/fast` remains the
 * default model's shortcut. Values live in plugin storage, so a fresh host
 * sees the same provider selections the last one wrote; a client reads them
 * back through `plugins.settings.list`.
 */
import { definePlugin } from "@nyte-ai/plugin";
import type { Api, Model } from "@nyte-ai/schema";

export const FAST_MODE_PLUGIN_ID = "fast-mode";

export interface FastModeModelCatalog {
  getModels(): readonly Model<Api>[];
  getModel(provider: string, id: string): Model<Api> | undefined;
}

export interface FastModePluginOptions {
  readonly models: FastModeModelCatalog;
  readonly defaultModel: Model<Api>;
}

/**
 * Fast inference bills at a premium and every provider prices it differently,
 * so a selection belongs to the provider it was made for, not to the session.
 */
function enabledKey(provider: string): string {
  return `enabled:${provider}`;
}

function supportsFastMode(model: Model<Api>): boolean {
  return model.modes?.includes("fast") ?? false;
}

export function fastModeSettingId(provider: string): string {
  return `fast:${provider}`;
}

export function fastModePlugin({ models, defaultModel }: FastModePluginOptions) {
  return definePlugin({
    id: FAST_MODE_PLUGIN_ID,
    session(api) {
      const providers = [
        ...new Set(
          models
            .getModels()
            .filter(supportsFastMode)
            .map((model) => model.provider),
        ),
      ];

      if (providers.length === 0) return;

      api.settings.add((settings) => {
        for (const provider of providers) {
          settings.set(fastModeSettingId(provider), {
            label: providers.length === 1 ? "Fast mode" : `Fast mode · ${provider}`,
            key: enabledKey(provider),
            fallback: "off",
            choices: [
              {
                id: "on",
                label: "on",
                description: "Priority processing at a premium",
                status: "fast",
              },
              { id: "off", label: "off", description: "Standard processing" },
            ],
          });
        }
      });

      if (supportsFastMode(defaultModel)) {
        const key = enabledKey(defaultModel.provider);
        const read = async (): Promise<boolean> => (await api.storage.get(key)) === "on";

        const write = (enabled: boolean): Promise<void> =>
          api.storage.set(key, enabled ? "on" : "off");

        api.commands.add((commands) =>
          commands.set("fast", {
            description: "Toggle fast inference",
            run: async (argument) => {
              if (argument !== "") throw new Error("/fast takes no argument");
              const enabled = !(await read());
              await write(enabled);

              return `Fast mode: ${enabled ? "on" : "off"}`;
            },
          }),
        );
      }

      api.hook("before_request", async (event) => {
        if (event.step !== "assistant") return undefined;
        const model = models.getModel(event.model.provider, event.model.modelId);

        if (model === undefined || !supportsFastMode(model)) return undefined;
        const enabled = (await api.storage.get(enabledKey(model.provider))) === "on";

        return enabled ? { streamOptions: { fast: true } } : undefined;
      });
    },
  });
}
