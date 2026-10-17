import type { Credential, CredentialAccounts } from "@nyte-ai/ai/auth/types";

/** Returns `credential` stored as the one active `default` account. */
export function storedAccounts(credential: Credential): CredentialAccounts {
  return {
    active: "default",
    accounts: [{ id: "default", label: "Default", credential }],
  };
}
