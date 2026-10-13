import { join } from "node:path";
import { FileModelsStore, nyteProviders } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { Models } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema/model";
import { readNyteUsage } from "./store-usage.ts";
import { createUsageScanCaches, readLocalUsage } from "./usage.ts";
import type { UsageSnapshot, UsageWindow } from "./usage-types.ts";

export interface UsageScanRequest {
  readonly window: UsageWindow;
  readonly catalog?: readonly Model<Api>[];
}

export type UsageScan = UsageSnapshot;

export interface UsageScanReader {
  scan(request: UsageScanRequest): Promise<UsageScan>;
  close(): Promise<void>;
}

export function catalogForUsage(models: Pick<Models, "getModels">): readonly Model<Api>[] {
  return [...models.getModels("anthropic"), ...models.getModels("openai-codex")];
}

export class UsageScanner implements UsageScanReader {
  private readonly home: string;
  private readonly caches = createUsageScanCaches();
  private readonly models: ReturnType<typeof createModels>;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(home: string) {
    this.home = home;
    this.models = createModels({
      modelsStore: new FileModelsStore(join(home, ".nyte", "models-store.json")),
    });

    for (const provider of nyteProviders()) this.models.setProvider(provider);
  }

  scan(request: UsageScanRequest): Promise<UsageScan> {
    const result = this.serial.then(async () => {
      if (request.catalog === undefined)
        await this.models.refresh({
          providers: ["anthropic", "openai-codex"],
          allowNetwork: false,
        });
      const catalog = request.catalog;

      const models: Pick<Models, "getModels"> =
        catalog === undefined
          ? this.models
          : {
              getModels: (provider) =>
                catalog.filter((model) => provider === undefined || model.provider === provider),
            };

      const local = await readLocalUsage({ models, caches: this.caches });
      const report = readNyteUsage(this.home, request.window);

      return {
        ...report,
        ...local,
        nyteError: report.sources.find((source) => source.status === "failed")?.message ?? null,
      };
    });

    this.serial = result.catch(() => undefined);

    return result;
  }

  async close(): Promise<void> {
    await this.serial;
  }
}
