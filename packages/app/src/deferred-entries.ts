import type { chartsRuntime } from "./chrome/usage-charts.deferred.ts";
import type { codeRuntime } from "./conversation/code.deferred.tsx";
import type { workbenchRuntime } from "./workbench/panels.deferred.tsx";

/**
 * The interface's deferred entries. Each builds as its own chunk, loads the
 * first time `loadDeferred` asks for it, and fails the build if a package it
 * lists reaches the startup imports. `module` publishes the runtime with
 * `publishDeferred`; `packages` are paths under `node_modules/`.
 */
export const deferredEntries = {
  code: {
    module: new URL("./conversation/code.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "shiki/"],
  },
  workbench: {
    module: new URL("./workbench/panels.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "preact/", "ghostty-web/"],
  },
  charts: {
    module: new URL("./chrome/usage-charts.deferred.ts", import.meta.url).href,
    packages: ["@nivo/", "d3-shape/", "@react-spring/"],
  },
} as const;

/**
 * What each deferred entry publishes, keyed by entry name. A host that adds
 * its own entries merges their runtimes into this interface.
 */
export interface DeferredRuntimes {
  code: typeof codeRuntime;
  workbench: typeof workbenchRuntime;
  charts: typeof chartsRuntime;
}
