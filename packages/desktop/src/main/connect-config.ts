import { namesBrokerOrigin } from "@nyte-ai/connect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { checkedFrontendApiHost } from "../account/policy.ts";

export interface ConnectConfig {
  readonly origin: string;
  readonly clerk: {
    readonly publishableKey: string;
    readonly frontendApiHost: string;
  };
}

const ConnectEnv = Type.Object({
  MAIN_VITE_NYTE_CONNECT_ORIGIN: Type.String(),
  MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY: Type.String(),
  MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST: Type.String(),
});

export function readConnectConfig(
  env: Readonly<Record<string, string | boolean | undefined>>,
): ConnectConfig | undefined {
  if (!Value.Check(ConnectEnv, env)) return undefined;
  const origin = env.MAIN_VITE_NYTE_CONNECT_ORIGIN;
  const publishableKey = env.MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY;
  const frontendApiHost = env.MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST;

  if (!namesBrokerOrigin(origin)) return undefined;

  try {
    return {
      origin,
      clerk: {
        publishableKey,
        frontendApiHost: checkedFrontendApiHost({ publishableKey, frontendApiHost }),
      },
    };
  } catch {
    return undefined;
  }
}
