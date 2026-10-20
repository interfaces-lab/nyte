import process from "node:process";
import { files } from "@nyte-ai/canvas/shell-files";
import { chromiumCanvasPreview } from "@nyte-ai/host/canvas-preview";
import { nodeImages } from "@nyte-ai/host/images";
import { canvasPlugin } from "@nyte-ai/plugin/core/canvas";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import { dev, sdk } from "@nyte-ai/sdk";
import type { Host, OpenHostOptions } from "@nyte-ai/sdk";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import { imageRuntimeOptions } from "./image-runtime.ts";

export function openTerminalHost(
  options: Pick<OpenHostOptions, "execution" | "label" | "onRevoked"> = {},
): Promise<Host> {
  if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "tui");

  return sdk.open({
    plugins: [codemodePlugin(codemodeRuntimeOptions()), canvasPlugin(chromiumCanvasPreview(files))],
    images: nodeImages(imageRuntimeOptions()),
    execution: options.execution ?? { kind: "run", coverage: { kind: "all" } },
    label: options.label,
    onRevoked: options.onRevoked,
  });
}
