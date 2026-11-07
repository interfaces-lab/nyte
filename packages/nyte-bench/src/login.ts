import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCredentialAccounts } from "@nyte-ai/ai/auth/types";
import type { CredentialAccounts, CredentialStore } from "@nyte-ai/ai/auth/types";
import { decodeKvValue, kvRef } from "@nyte-ai/core/store";
import { openSecret, storePath } from "@nyte-ai/host";
import { isJson } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";

const ROW = Type.Object({ body: Type.String() });

const SEALED = Type.Object({ iv: Type.String(), ciphertext: Type.String() });

/** A login that expires sooner than this is refused, so a run doesn't stop halfway. */
const MARGIN_MS = 15 * 60 * 1000;

/**
 * The providers' logins from the Nyte host's store, read once with a read-only connection.
 * The store refreshes nothing and writes nothing: refreshing an OAuth token here would
 * rotate it under the running host and could sign it out, so an expired login stays
 * expired until Nyte itself refreshes it.
 */
export async function readNyteLogins(providers: readonly string[]): Promise<CredentialStore> {
  const home = homedir();
  const key = new Uint8Array(await readFile(join(home, ".nyte", "secret.key")));
  const database = new DatabaseSync(storePath(home), { readOnly: true });

  const statement = database.prepare(
    "SELECT objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE refs.name = ?",
  );

  const found = await Promise.all(
    providers.map(async (provider) => {
      const row = statement.get(kvRef("secret", "models", provider));

      if (!Value.Check(ROW, row)) return [];
      const parsed: unknown = JSON.parse(row.body);
      const sealed = isJson(parsed) ? decodeKvValue(parsed) : undefined;

      if (!Value.Check(SEALED, sealed)) return [];
      const plain = await openSecret({ key: async () => key }, `${sealed.iv}.${sealed.ciphertext}`);
      const accounts = readCredentialAccounts(JSON.parse(plain));

      return accounts === undefined ? [] : [[provider, accounts] as const];
    }),
  );

  database.close();
  const logins = new Map(found.flat());

  for (const [provider, accounts] of logins) requireFresh(provider, accounts);

  return {
    async read(provider) {
      return logins.get(provider);
    },
    async list() {
      return [...logins].flatMap(([providerId, accounts]) =>
        accounts.accounts.map((account) => ({
          providerId,
          id: account.id,
          label: account.label,
          type: account.credential.type,
          active: accounts.active === account.id,
        })),
      );
    },
    async modify(provider) {
      throw new Error(
        `The eval never refreshes or changes Nyte's ${provider} login. Use a ${provider} model in Nyte once so the host refreshes it, then run the eval again.`,
      );
    },
    async delete(provider) {
      throw new Error(`The eval never removes Nyte's ${provider} login.`);
    },
  };
}

function requireFresh(provider: string, accounts: CredentialAccounts): void {
  const credential = accounts.accounts.find(
    (account) => account.id === accounts.active,
  )?.credential;

  if (credential?.type !== "oauth" || credential.expires > Date.now() + MARGIN_MS) return;

  throw new Error(
    `Nyte's ${provider} login expires ${credential.expires > Date.now() ? "in under 15 minutes" : "or has expired"}, and the eval never refreshes it. Use a ${provider} model in Nyte once so the host refreshes it, then run the eval again.`,
  );
}
