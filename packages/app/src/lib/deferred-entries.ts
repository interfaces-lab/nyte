import type { chartsRuntime } from "../settings/usage-charts.deferred.ts";
import type { codeRuntime } from "../chat/markdown/code.deferred.tsx";
import type { highlightRuntime } from "../chat/markdown/highlight.deferred.ts";
import type { mermaidRuntime } from "../chat/markdown/mermaid.deferred.ts";
import type { ghosttyRuntime } from "../workbench/terminal/ghostty.deferred.ts";
import type { workbenchRuntime } from "../workbench/panels.deferred.tsx";

export const deferredEntries = {
  code: {
    module: new URL("../chat/markdown/code.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "shiki/"],
  },
  highlight: {
    module: new URL("../chat/markdown/highlight.deferred.ts", import.meta.url).href,
    packages: ["@pierre/highlights/"],
  },
  mermaid: {
    module: new URL("../chat/markdown/mermaid.deferred.ts", import.meta.url).href,
    packages: ["beautiful-mermaid/", "elkjs/"],
  },
  workbench: {
    module: new URL("../workbench/panels.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "preact/"],
  },
  ghostty: {
    module: new URL("../workbench/terminal/ghostty.deferred.ts", import.meta.url).href,
    packages: ["ghostty-web/"],
  },
  charts: {
    module: new URL("../settings/usage-charts.deferred.ts", import.meta.url).href,
    packages: ["@nivo/", "d3-shape/", "@react-spring/"],
  },
} as const;

export interface DeferredRuntimes {
  code: typeof codeRuntime;
  highlight: typeof highlightRuntime;
  mermaid: typeof mermaidRuntime;
  workbench: typeof workbenchRuntime;
  ghostty: typeof ghosttyRuntime;
  charts: typeof chartsRuntime;
}
