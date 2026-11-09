import { glob, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { stylex } from "../stylex.mjs";
import { context } from "esbuild";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const outdir = join(packageRoot, "dist");

const watch = process.argv.includes("--watch");

const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

const nestedEntries = Object.values(manifest.exports)
  .filter((target) => target.default !== undefined && target["nyte-source"]?.split("/").length > 3)
  .map((target) => relative(".", target["nyte-source"]));

const entryPoints = [
  ...(await Array.fromAsync(glob(["src/*.ts", "src/*.tsx"], { cwd: packageRoot }))),
  ...nestedEntries,
];

const layerStylesheet = {
  name: "nyte-ui-layer",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;

      const collected = join(outdir, "stylex.css");
      const css = await readFile(collected, "utf8");
      await writeFile(join(outdir, "ui.css"), `@layer nyte-ui {\n${css}\n}\n`);
      await rm(collected);

      for (const entry of entryPoints) {
        if (
          entry.endsWith(".stylex.ts") ||
          ["style.ts", "surface-theme.ts", "appearance.ts", "platform-colors.ts"].includes(
            basename(entry),
          )
        )
          continue;
        const compiled = join(outdir, `${relative("src", entry).replace(/\.tsx?$/, "")}.js`);
        const javascript = await readFile(compiled, "utf8");
        await writeFile(compiled, `"use client";\n${javascript}`);
      }
    });
  },
};

const buildContext = await context({
  absWorkingDir: packageRoot,
  entryPoints,
  outbase: "src",
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  packages: "external",
  chunkNames: "chunks/[name]-[hash]",
  metafile: true,
  logLevel: "info",
  plugins: [
    stylex.esbuild({
      dev: false,
      runtimeInjection: false,
      treeshakeCompensation: true,
      classNamePrefix: "nyte",
      useCSSLayers: true,
      propertyValidationMode: "throw",
      unstable_moduleResolution: { type: "commonJS", rootDir: packageRoot },
      lightningcssOptions: {
        targets: { chrome: 123 << 16, firefox: 120 << 16, safari: (17 << 16) | (5 << 8) },
      },
    }),
    layerStylesheet,
  ],
});

if (watch) {
  await buildContext.watch();
} else {
  await rm(outdir, { recursive: true, force: true });
  await buildContext.rebuild();
  await buildContext.dispose();
}
