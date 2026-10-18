import { Config } from "@remotion/cli/config";
import { stylex } from "@nyte-ai/ui/stylex";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Compiler } from "webpack";

/** A package file as the app resolves it: through the package's `exports` map, from the app's node_modules. */
function resolveFromApp(request: string) {
  const parts = request.split("/");
  const name = request.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  const subpath = `.${request.slice(name.length)}`;
  const root = realpathSync(join(process.cwd(), "../app/node_modules", name));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const target = manifest.exports?.[subpath];
  const file = typeof target === "string" ? target : (target?.import ?? target?.default ?? subpath);
  return join(root, file);
}

/** Vite `?url` imports name a file by package path; webpack resolves the file, then emits it as an asset. */
const urlImports = {
  apply(compiler: Compiler) {
    compiler.hooks.normalModuleFactory.tap("nyte-film-url", (factory) => {
      factory.hooks.beforeResolve.tap("nyte-film-url", (data) => {
        const [request, query] = data.request.split("?");
        if (query !== "url" || request === undefined || request.startsWith(".") || request.startsWith("/")) return;
        data.request = `${resolveFromApp(request)}?url`;
      });
    });
  },
};

/** StyleX appends its rules to a CSS asset; Remotion inlines CSS through JS, so give it one. */
const sheet = {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap("nyte-film-sheet", (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: "nyte-film-sheet", stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          compilation.emitAsset("stylex.css", new compiler.webpack.sources.RawSource("/* StyleX */\n"));
        },
      );
    });
  },
};

/** StyleX collects its rules while modules transform, so a cached build would emit an empty sheet. */
Config.setCachingEnabled(false);

/**
 * The film renders the app's real components, so the bundle resolves the
 * workspace's StyleX source and compiles it the way the lab's Vite build does.
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  module: {
    ...config.module,
    rules: [{ resourceQuery: /url/, type: "asset/resource" }, ...(config.module?.rules ?? [])],
  },
  resolve: {
    ...config.resolve,
    conditionNames: ["nyte-source", "import", "module", "browser", "default"],
  },
  plugins: [
    ...(config.plugins ?? []),
    sheet,
    urlImports,
    stylex.webpack({
      useCSSLayers: true,
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
  ],
}));
