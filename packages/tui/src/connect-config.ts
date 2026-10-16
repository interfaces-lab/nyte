import process from "node:process";
import { isBrokerOrigin } from "@nyte-ai/connect";
import type { HostConnectConfig } from "@nyte-ai/connect/host";

declare const NYTE_BUILT_CONNECT_ORIGIN: string | undefined;

const DEFAULT_CONNECT_ORIGIN = "https://nyte-connect.daniel-fu90.workers.dev";

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
