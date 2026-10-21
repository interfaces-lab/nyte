import type { chartsRuntime } from "./chrome/usage-charts.deferred.ts";
import type { codeRuntime } from "./conversation/code.deferred.tsx";
import type { highlightRuntime } from "./conversation/highlight.deferred.ts";
import type { ghosttyRuntime } from "./workbench/ghostty.deferred.ts";
import type { workbenchRuntime } from "./workbench/panels.deferred.tsx";

export const deferredEntries = {
  code: {
    module: new URL("./conversation/code.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "shiki/"],
  },
  highlight: {
    module: new URL("./conversation/highlight.deferred.ts", import.meta.url).href,
    packages: ["@pierre/highlights/"],
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
  highlight: typeof highlightRuntime;
  workbench: typeof workbenchRuntime;
  ghostty: typeof ghosttyRuntime;
  charts: typeof chartsRuntime;
}
