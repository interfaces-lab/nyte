/**
 * The terminal's host: composed in-process with `sdk.open` over this
 * machine's store, serving the folder the launch started in through the
 * local environment, with the terminal's core plugins.
 */
import { codemodePlugin } from "@nyte-ai/plugin/codemode";
import questionPlugin from "@nyte-ai/plugin/question";
import telemetryPlugin from "@nyte-ai/plugin/telemetry";
import { sdk } from "@nyte-ai/sdk";
import type { Host } from "@nyte-ai/sdk";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";

/**
 * Opens the host for the folder the launch started in with the question,
 * telemetry and codemode plugins. The store (`~/.nyte/nyte.db`, shared by
 * every launch on this machine), the local environment, plugin files,
 * settings, the secrets key and each credentialed provider's saved catalog
 * are the host's defaults; closing the host closes its store.
 */
export function openTerminalHost(): Promise<Host> {
  return sdk.open({
    plugins: [questionPlugin, telemetryPlugin, codemodePlugin(codemodeRuntimeOptions())],
  });
}
