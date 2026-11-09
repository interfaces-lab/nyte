import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";
import { codemodePlugin } from "../scripts/codemode-plugin.ts";
import { binaryDefines } from "../scripts/defines.ts";
import { docsPlugin } from "../scripts/docs-plugin.ts";
import { photonPlugin } from "../scripts/photon-plugin.ts";

const packages = fileURLToPath(new URL("../../", import.meta.url));

const outdir = await mkdtemp(join(tmpdir(), "nyte-bundle-"));

const result = await Bun.build({
  entrypoints: [join(packages, "tui/src/index.ts")],
  root: packages,
  target: "bun",
  plugins: [solidPlugin, codemodePlugin, photonPlugin, docsPlugin],
  define: binaryDefines(process.env),
  external: ["@opentui/core-*"],
  format: "esm",
  outdir,
  metafile: true,
});

if (!result.success || result.metafile === undefined) {
  throw new Error(result.logs.map((log) => log.message).join("\n"));
}

const byOwner = new Map<string, number>();

for (const [path, input] of Object.entries(result.metafile.inputs)) {
  const owner =
    [...path.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/gu)].at(-1)?.[1] ??
    path
      .replace(/^(?:\.\.\/)*/u, "")
      .split("/")
      .slice(0, 3)
      .join("/");

  byOwner.set(owner, (byOwner.get(owner) ?? 0) + input.bytes);
}

const kb = (kind: "asset" | "code"): number =>
  Math.round(
    result.outputs
      .filter((output) => (output.kind === "asset") === (kind === "asset"))
      .reduce((sum, output) => sum + output.size, 0) / 1024,
  );

const entryKb = kb("code");

const assetsKb = kb("asset");

await rm(outdir, { recursive: true, force: true });

process.stdout.write(
  `${JSON.stringify({
    entry_js_kb: entryKb,
    assets_kb: assetsKb,
    entry_inputs: Object.keys(result.metafile.inputs).length,
    top: [...byOwner]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([owner, bytes]) => `${owner}:${String(Math.round(bytes / 1024))}K`),
  })}\n`,
);
