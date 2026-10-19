import { plugin } from "bun";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { transformSolidSource } from "/Users/workgyver/Developer/nyte/packages/tui/node_modules/@opentui/solid/scripts/solid-transform.js";
import * as core from "@opentui/core";
const cache = new Map<string, string>();
const shared = new Map<string, Record<string, unknown>>();
let sharedLoads = 0;
plugin({ name: "dev-share", setup(b) {
  b.onResolve({ filter: /^(?![./]|node:|bun:)/ }, ({ path, importer }) => {
    if (!importer || importer.includes("/node_modules/")) return undefined;
    const real = Bun.resolveSync(path, dirname(importer));
    if (!real.includes("/node_modules/")) return undefined;
    return { path: real, namespace: "shared" };
  });
  b.onLoad({ filter: /.*/, namespace: "shared" }, async ({ path }) => {
    let ns = shared.get(path);
    if (ns === undefined) { sharedLoads++; ns = { ...(await import(path)) }; shared.set(path, ns); }
    return { loader: "object", exports: ns };
  });
  b.onLoad({ filter: /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx$/ }, async ({ path }) => {
    const code = await readFile(path, "utf8");
    const key = path + "\0" + Bun.hash(code);
    let out = cache.get(key);
    if (out === undefined) { out = await transformSolidSource(code, { filename: path, moduleName: "@opentui/solid" }); cache.set(key, out); }
    return { contents: out, loader: "js" };
  });
}});
const main = new URL("./src/app/main.tsx", import.meta.url).pathname;
for (let i = 0; i < 6; i++) {
  const s = performance.now(); const l0 = sharedLoads;
  const g = new Bun.ModuleGraph({ onError: (e) => console.error("graph error", e) });
  const app = await g.import(main);
  const c = await g.import("@opentui/core").catch(() => null);
  console.log("graph " + i + ": " + (performance.now() - s).toFixed(0) + "ms, new shared " + (sharedLoads - l0) + ", mountApp " + typeof app.mountApp);
  g.dispose();
}
console.log("host core is a shared entry:", [...shared.keys()].some((k) => k.includes("@opentui/core")), "total shared", shared.size);
