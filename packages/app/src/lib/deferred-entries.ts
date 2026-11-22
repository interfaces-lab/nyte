import type { codeRuntime } from "../markdown/code.deferred.tsx";
import type { imageViewerRuntime } from "../chat/images/image-viewer.deferred.tsx";
import type { highlightRuntime } from "../markdown/highlight.deferred.ts";
import type { mermaidRuntime } from "../markdown/mermaid.deferred.ts";
import type { previewsRuntime } from "../settings/previews/previews.deferred.tsx";
import type { needsYouRuntime } from "../shell/needs-you-list.deferred.tsx";
import type { ghosttyRuntime } from "../terminal/ghostty.deferred.ts";
import type { pdfRuntime } from "../editor/pdf/pdf.deferred.ts";
import type { workbenchRuntime } from "../workbench/panels.deferred.tsx";

export const deferredEntries = {
  images: {
    module: new URL("../chat/images/image-viewer.deferred.tsx", import.meta.url).href,
    packages: [],
  },
  code: {
    module: new URL("../markdown/code.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "shiki/"],
  },
  highlight: {
    module: new URL("../markdown/highlight.deferred.ts", import.meta.url).href,
    packages: ["@pierre/highlights/"],
  },
  mermaid: {
    module: new URL("../markdown/mermaid.deferred.ts", import.meta.url).href,
    packages: ["beautiful-mermaid/", "elkjs/"],
  },
  workbench: {
    module: new URL("../workbench/panels.deferred.tsx", import.meta.url).href,
    packages: ["@pierre/diffs/", "preact/"],
  },
  ghostty: {
    module: new URL("../terminal/ghostty.deferred.ts", import.meta.url).href,
    packages: [],
  },
  pdf: {
    module: new URL("../editor/pdf/pdf.deferred.ts", import.meta.url).href,
    packages: ["pdfjs-dist/"],
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
  previews: typeof previewsRuntime;
  needsYou: typeof needsYouRuntime;
}
