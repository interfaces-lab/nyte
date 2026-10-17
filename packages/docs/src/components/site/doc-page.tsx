import { mdxComponents } from "~/components/mdx";
import type { DocPage } from "~/lib/docs";
import { pageHead } from "~/lib/seo";
import { DocArticle } from "./article";

export function DocPageView({ page }: { page: DocPage }) {
  return (
    <DocArticle
      eyebrow={page.section}
      title={page.title}
      lede={page.description}
      toc={page.toc}
      previous={page.previous}
      next={page.next}
    >
      <page.Body components={mdxComponents} />
    </DocArticle>
  );
}

export function docPageHead(page: DocPage | undefined, canonical?: string) {
  if (!page) return {};
  return pageHead({
    title: page.title,
    description: page.description,
    image: page.imageUrl,
    type: "article",
    canonical,
  });
}
