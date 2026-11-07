import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { nyteProviders } from "../src/providers/nyte-catalog.ts";

export async function verifyNyteCatalogs(catalogDir: string): Promise<void> {
  const failures: string[] = [];

  for (const provider of nyteProviders()) {
    const path = join(catalogDir, `${provider.id}.json`);

    if (!existsSync(path)) continue;
    const catalog: unknown = JSON.parse(readFileSync(path, "utf8"));

    if (!Array.isArray(catalog)) {
      failures.push(`${provider.id}: catalog is not an array`);
      continue;
    }

    const modelsStore = new InMemoryModelsStore();
    await modelsStore.write(provider.id, { models: catalog });
    const models = createModels({ modelsStore });
    models.setProvider(provider);
    const result = await models.refresh({ allowNetwork: false });
    const served = models.getModels(provider.id).filter((model) => model.variant === undefined);

    for (const error of result.errors.values()) failures.push(`${provider.id}: ${error.message}`);

    if (served.length !== catalog.length) {
      failures.push(`${provider.id}: serves ${served.length} of ${catalog.length} catalog models`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Generated catalogs fail runtime validation:\n${failures.join("\n")}`);
  }
}
