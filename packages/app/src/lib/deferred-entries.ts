import type { chartsRuntime } from "../settings/usage-charts.deferred.ts";
import type { codeRuntime } from "../chat/markdown/code.deferred.tsx";
import type { imageViewerRuntime } from "../chat/images/image-viewer.deferred.tsx";
import type { highlightRuntime } from "../chat/markdown/highlight.deferred.ts";
import type { mermaidRuntime } from "../chat/markdown/mermaid.deferred.ts";
import type { previewsRuntime } from "../settings/previews/previews.deferred.tsx";
import type { needsYouRuntime } from "../shell/needs-you-list.deferred.tsx";
import type { ghosttyRuntime } from "../workbench/terminal/ghostty.deferred.ts";
import type { pdfRuntime } from "../workbench/editor/pdf/pdf.deferred.ts";
import type { workbenchRuntime } from "../workbench/panels.deferred.tsx";

export const deferredEntries = {
  images: {
    module: new URL("../chat/images/image-viewer.deferred.tsx", import.meta.url).href,
    packages: [],
  },
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
    packages: [],
  },
  pdf: {
    module: new URL("../workbench/editor/pdf/pdf.deferred.ts", import.meta.url).href,
    packages: ["pdfjs-dist/"],
  },
  charts: {
    module: new URL("../settings/usage-charts.deferred.ts", import.meta.url).href,
    packages: ["@nivo/", "d3-shape/", "@react-spring/"],
  },
  previews: {
    module: new URL("../settings/previews/previews.deferred.tsx", import.meta.url).href,
    packages: [],
  },
  needsYou: {
    module: new URL("../shell/needs-you-list.deferred.tsx", import.meta.url).href,
    packages: [],
  },
} as const;

export interface DeferredRuntimes {
  images: typeof imageViewerRuntime;
  code: typeof codeRuntime;
  highlight: typeof highlightRuntime;
  mermaid: typeof mermaidRuntime;
  workbench: typeof workbenchRuntime;
  ghostty: typeof ghosttyRuntime;
  pdf: typeof pdfRuntime;
  charts: typeof chartsRuntime;
  previews: typeof previewsRuntime;
  needsYou: typeof needsYouRuntime;
}
