import { join } from "node:path";
import type { OpenOptions } from "@nyte-ai/core";
import { readKeyFile } from "./key-file.ts";

/** Returns where a host gets the 32-byte key core encrypts secrets with: `OpenOptions.secrets` (decision 10). */
export type SecretsSource = NonNullable<OpenOptions["secrets"]>;

/**
 * Returns the Node host's default secrets key: `<home>/.nyte/secret.key`, 32
 * raw bytes read or minted by `readKeyFile` (decision 10; §43d as amended by
 * §43i). The source memoises a resolved answer itself; a rejected one is not
 * kept, so the next call reads again (§43k). The key is for secrets only: the
 * host's identity has its own file (§50a). There is no keychain here: a
 * desktop supplies its own `OpenOptions.secrets.key()` (Electron
 * `safeStorage`).
 */
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
