/**
 * The public build configuration for account remote access. Every value is
 * public by design and reaches main through `MAIN_VITE_*` at build time. A
 * build missing any of them, or carrying one that is not a canonical HTTPS
 * origin or hostname, has no account remote access at all: nothing asks for a
 * session token or a broker answer on its behalf.
 */
import { isBrokerOrigin } from "@nyte-ai/connect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { checkedFrontendApiHost } from "../account/policy.ts";

export interface ConnectConfig {
  /** `CONNECT_ORIGIN`, a canonical `https://` origin: the broker and its relay. */
  readonly origin: string;
  readonly clerk: {
    readonly publishableKey: string;
    /** The Frontend API host without scheme or port, such as `clerk.example.com`. */
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

  if (!isBrokerOrigin(origin)) return undefined;

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
