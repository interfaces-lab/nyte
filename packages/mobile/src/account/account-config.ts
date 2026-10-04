import { parseAccountConfig } from "@nyte-ai/connect/account-config";
import type { AccountConfig } from "@nyte-ai/connect/account-config";

export { parseAccountConfig } from "@nyte-ai/connect/account-config";

export type { AccountConfig } from "@nyte-ai/connect/account-config";

/** Expo inlines `EXPO_PUBLIC_*` only where it is read by its full literal name. */
export function readAccountConfig(): AccountConfig | undefined {
  return parseAccountConfig({
    publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    origin: process.env.EXPO_PUBLIC_NYTE_CONNECT_ORIGIN,
  });
}
