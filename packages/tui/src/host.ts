import process from "node:process";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import { dev, sdk } from "@nyte-ai/sdk";
import type { Host, OpenHostOptions } from "@nyte-ai/sdk";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";

export function openTerminalHost(
  execution: OpenHostOptions["execution"] = { kind: "run", coverage: { kind: "all" } },
): Promise<Host> {
  if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "tui");

  return sdk.open({ plugins: [codemodePlugin(codemodeRuntimeOptions())], execution });
}
