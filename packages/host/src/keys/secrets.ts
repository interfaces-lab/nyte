import { join } from "node:path";
import type { OpenOptions } from "@nyte-ai/core";
import { readKeyFile } from "./key-file.ts";

export type SecretsSource = NonNullable<OpenOptions["secrets"]>;

export function defaultSecrets(home: string): SecretsSource {
  const path = join(home, ".nyte", "secret.key");
  let key: Promise<Uint8Array> | null = null;

  return {
    key: () => {
      const known = key ?? readKeyFile(path, "secrets key");
      key = known;
      known.catch(() => {
        if (key === known) key = null;
      });

      return known;
    },
  };
}
