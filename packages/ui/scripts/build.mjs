import { glob, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin";
import { context } from "esbuild";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const outdir = join(packageRoot, "dist");

const watch = process.argv.includes("--watch");

const entryPoints = await Array.fromAsync(glob(["src/*.ts", "src/*.tsx"], { cwd: packageRoot }));

// StyleX's esbuild hook writes every collected rule to `dist/stylex.css`. The
// sheet ships as `dist/ui.css` inside one `nyte-ui` layer, so a consumer that
// orders the layer below its own StyleX and Tailwind utilities can override
// any component rule, including the token defaults.
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
          ["style.ts", "surface-theme.ts", "platform-colors.ts"].includes(basename(entry))
        )
          continue;
        const compiled = join(outdir, `${basename(entry).replace(/\.tsx?$/, "")}.js`);
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
      // An app's StyleX emits `x…` classes into its own layers. A shared name
      // there would re-declare a component rule above `nyte-ui` and reorder
      // shorthands against longhands, so library classes get their own prefix.
      classNamePrefix: "nyte",
      useCSSLayers: true,
      // A key StyleX cannot compile, like `border`, fails the build instead of vanishing.
      propertyValidationMode: "throw",
      unstable_moduleResolution: { type: "commonJS", rootDir: packageRoot },
      // Keeps light-dark() and color-mix() as written; older targets lower them.
      lightningcssOptions: {
        targets: { chrome: 123 << 16, firefox: 120 << 16, safari: (17 << 16) | (5 << 8) },
      },
    }),
    layerStylesheet,
  ],
});

// Watch mode keeps the declarations from the last full build.
if (watch) {
  await buildContext.watch();
} else {
  await rm(outdir, { recursive: true, force: true });
  await buildContext.rebuild();
  await buildContext.dispose();
}
