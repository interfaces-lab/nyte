import { fileURLToPath } from "node:url";
import { loadQuickJSWasm } from "@nyte-ai/plugin/core/codemode-runtime";
import { serveHostThread } from "@nyte-ai/service/host-worker";

const DOCS = "../../../docs/content/docs/";

const pages = import.meta.glob<string>("../../../docs/content/docs/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

serveHostThread({
  source: "desktop",
  codemode: {
    workerUrl: new URL("./codemode-worker.js", import.meta.url),
    get wasm() {
      return loadQuickJSWasm(fileURLToPath(new URL("./quickjs.wasm", import.meta.url)));
    },
  },
  images: {
    worker: new URL("./image-worker.js", import.meta.url),
    wasm: fileURLToPath(new URL("./photon_rs_bg.wasm", import.meta.url)),
  },
  docs: Object.fromEntries(
    Object.entries(pages).map(([path, text]) => [path.slice(DOCS.length), text]),
  ),
});
