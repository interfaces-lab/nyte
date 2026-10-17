import type { Credential, CredentialAccounts } from "../src/auth/types.ts";

export function storedAccounts(credential: Credential): CredentialAccounts {
  return {
    active: "default",
    accounts: [{ id: "default", label: "Default", credential }],
  };
}
