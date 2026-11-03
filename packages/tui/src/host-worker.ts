import { serveHostThread } from "@nyte-ai/service/host-worker";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import { imageRuntimeOptions } from "./image-runtime.ts";
import { bunPluginImport } from "./plugin-import.ts";

serveHostThread({
  source: "tui",
  codemode: codemodeRuntimeOptions(),
  images: imageRuntimeOptions(),
  pluginImport: bunPluginImport(),
});
