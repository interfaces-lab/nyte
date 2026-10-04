import { parseAccountConfig } from "@nyte-ai/connect/account-config";

export const accountConfig = parseAccountConfig({
  publishableKey: import.meta.env.VITE_NYTE_CLERK_PUBLISHABLE_KEY,
  origin: import.meta.env.VITE_NYTE_CONNECT_ORIGIN,
});
