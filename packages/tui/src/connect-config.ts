/**
 * The broker this binary links through. Public by design: a canonical
 * `https://` origin, from `NYTE_CONNECT_ORIGIN` at run time, else the value the
 * binary was built with, else Nyte's own broker.
 */
import process from "node:process";
import { isBrokerOrigin } from "@nyte-ai/connect";
import type { HostConnectConfig } from "@nyte-ai/connect/host";

/** Replaced by the bundler (`scripts/defines.ts`); unbundled it is undeclared, so only `typeof` may touch it. */
declare const NYTE_BUILT_CONNECT_ORIGIN: string | undefined;

export const DEFAULT_CONNECT_ORIGIN = "https://nyte-connect.daniel-fu90.workers.dev";

export function readConnectConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HostConnectConfig | undefined {
  const built =
    typeof NYTE_BUILT_CONNECT_ORIGIN === "string" && NYTE_BUILT_CONNECT_ORIGIN !== ""
      ? NYTE_BUILT_CONNECT_ORIGIN
      : DEFAULT_CONNECT_ORIGIN;
  const origin = env["NYTE_CONNECT_ORIGIN"] ?? built;

  return isBrokerOrigin(origin) ? { origin } : undefined;
}

export const CONNECT_UNCONFIGURED =
  "NYTE_CONNECT_ORIGIN isn't a valid Nyte Connect origin. Use an https:// origin with no path, or unset it to use Nyte's.";
