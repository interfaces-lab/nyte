import type { Credential, CredentialAccounts } from "@nyte-ai/ai/auth/types";

export function storedAccounts(credential: Credential): CredentialAccounts {
  return {
    active: "default",
    accounts: [{ id: "default", label: "Default", credential }],
  };
}
