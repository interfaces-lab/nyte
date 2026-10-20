import type { chartsRuntime } from "./chrome/usage-charts.deferred.ts";
import type { codeRuntime } from "./conversation/code.deferred.tsx";
import type { ghosttyRuntime } from "./workbench/ghostty.deferred.ts";
import type { workbenchRuntime } from "./workbench/panels.deferred.tsx";

export const deferredEntries = {
  code: {
    module: new URL("./conversation/code.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "shiki/"],
  },
  workbench: {
    module: new URL("./workbench/panels.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "preact/"],
  },
  ghostty: {
    module: new URL("./workbench/ghostty.deferred.ts", import.meta.url).href,
    packages: ["ghostty-web/"],
  },
  charts: {
    module: new URL("./chrome/usage-charts.deferred.ts", import.meta.url).href,
    packages: ["@nivo/", "d3-shape/", "@react-spring/"],
  },
} as const;

export interface DeferredRuntimes {
  code: typeof codeRuntime;
  workbench: typeof workbenchRuntime;
  ghostty: typeof ghosttyRuntime;
  charts: typeof chartsRuntime;
}
