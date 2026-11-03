import { homedir } from "node:os";
import process from "node:process";
import { files } from "@nyte-ai/canvas/shell-files";
import { chromiumCanvasPreview } from "@nyte-ai/host/canvas-preview";
import { nodeImages } from "@nyte-ai/host/images";
import { clientBrowserPlugins } from "@nyte-ai/plugin/core/browser-client";
import { canvasPlugin } from "@nyte-ai/plugin/core/canvas";
import { clientCanvasPreview } from "@nyte-ai/plugin/core/canvas-client";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import { dev, sdk } from "@nyte-ai/sdk";
import type { Host, OpenHostOptions } from "@nyte-ai/sdk";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import { imageRuntimeOptions } from "./image-runtime.ts";
import { bunPluginImport } from "./plugin-import.ts";

/** Opens the host this process serves. With `clients`, the browser tools and canvas previews are the ones a connected Nyte.app offers, and previews fall back to Chromium while none does. */
export function openTerminalHost(
  options: Pick<OpenHostOptions, "execution" | "label" | "onRevoked" | "shell" | "plugins"> & {
    readonly clients?: boolean;
  } = {},
): Promise<Host> {
  if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "tui");
  const preview = chromiumCanvasPreview(files);

  return sdk.open({
    plugins: [codemodePlugin(codemodeRuntimeOptions()), ...(options.plugins ?? [])],
    clientPlugins: (actions) =>
      options.clients === true
        ? [
            ...clientBrowserPlugins(actions, homedir()),
            canvasPlugin(clientCanvasPreview(actions, preview)),
          ]
        : [canvasPlugin(preview)],
    images: nodeImages(imageRuntimeOptions()),
    pluginImport: bunPluginImport(),
    execution: options.execution ?? { kind: "run", coverage: { kind: "all" } },
    label: options.label,
    onRevoked: options.onRevoked,
    shell: options.shell,
  });
}
