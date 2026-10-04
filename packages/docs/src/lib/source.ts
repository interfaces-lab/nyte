import { loader } from "fumadocs-core/source";
import {
  cloudContentRoute,
  cloudRoute,
  docsContentRoute,
  docsImageRoute,
  docsRoute,
  kernelRoute,
  kernelContentRoute,
} from "./shared";
import { defineDocs } from "fumadocs-mdx/macro";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// Cloud is Nyte's design system. It is a second collection with its own
// route root so the primitives catalog does not sit inside the core docs tree.
const cloud = defineDocs({
  dir: "content/cloud",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

const kernel = defineDocs({
  dir: "content/kernel",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
// The sidebar tree carries no icons; Central Icons appear only in page
// content through <DocCard icon="…" /> (src/components/mdx/doc-card.tsx).
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});

export const cloudSource = loader({
  baseUrl: cloudRoute,
  source: cloud.toFumadocsSource(),
});

export const kernelSource = loader({
  baseUrl: kernelRoute,
  source: kernel.toFumadocsSource(),
});
type DocsPage = (typeof source)["$inferPage"];

export function getPageImageUrl(page: DocsPage) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: "/" + [page.locale, ...docsImageRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export function getPageMarkdownUrl(page: DocsPage) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: "/" + [page.locale, ...docsContentRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export function getCloudPageMarkdownUrl(page: DocsPage) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url:
      "/" + [page.locale, ...cloudContentRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export function getKernelPageMarkdownUrl(page: DocsPage) {
  const segments = [...page.slugs, "content.md"];
  return {
    segments,
    url:
      "/" + [page.locale, ...kernelContentRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

export async function getLLMText(page: DocsPage) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}
