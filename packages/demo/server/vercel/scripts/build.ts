/**
 * Bundles the function into `dist/`, a self-contained Vercel project: one
 * ESM file under `api/`, a `vercel.json` that routes everything to it, and a
 * dependency-free `package.json` so the platform installs nothing. Workspace
 * packages ship raw TypeScript, which is why the bundle happens here.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const dist = new URL("../dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(new URL("api/", dist), { recursive: true });
// The project link lives beside the source; the deploy runs from `dist/`.
await cp(new URL("../.vercel/", import.meta.url), new URL(".vercel/", dist), {
  recursive: true,
  force: true,
}).catch(() => undefined);

await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("api/index.mjs", dist).pathname,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // CommonJS dependencies still call `require` for builtins after bundling.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "info",
});

await writeFile(
  new URL("vercel.json", dist),
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      rewrites: [{ source: "/(.*)", destination: "/api/index" }],
      functions: { "api/index.mjs": { maxDuration: 300 } },
    },
    null,
    2,
  ),
);
await writeFile(
  new URL("package.json", dist),
  JSON.stringify(
    { name: "nyte-server", private: true, type: "module", engines: { node: "24.x" } },
    null,
    2,
  ),
);
