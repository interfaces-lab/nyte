/**
 * The broker this binary links through. Public by design: a canonical
 * `https://` origin, from `NYTE_CONNECT_ORIGIN` at run time or the value the
 * binary was built with. A binary with neither offers no account linking.
 */
import process from "node:process";
import { isBrokerOrigin } from "@nyte-ai/connect";
import type { HostConnectConfig } from "@nyte-ai/connect/host";

/** Replaced by the bundler (`scripts/defines.ts`); unbundled it is undeclared, so only `typeof` may touch it. */
declare const NYTE_BUILT_CONNECT_ORIGIN: string | undefined;

/** The origin the binary was built with; none unbundled or when the build set none. */
export function builtConnectOrigin(): string | undefined {
  return typeof NYTE_BUILT_CONNECT_ORIGIN === "string" && NYTE_BUILT_CONNECT_ORIGIN !== ""
    ? NYTE_BUILT_CONNECT_ORIGIN
    : undefined;
}

export function readConnectConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HostConnectConfig | undefined {
  const origin = env["NYTE_CONNECT_ORIGIN"] ?? builtConnectOrigin();

  return origin !== undefined && isBrokerOrigin(origin) ? { origin } : undefined;
}

export const CONNECT_UNCONFIGURED =
  "Account linking isn't configured for this build. Set NYTE_CONNECT_ORIGIN to the Nyte Connect origin.";
