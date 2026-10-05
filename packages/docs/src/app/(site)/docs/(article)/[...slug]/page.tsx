import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docsMdxComponents } from "~/components/mdx";
import { KERNEL, REVISION, sourceUrl } from "~/components/mdx/kernel/source";
import { sectionFor } from "~/lib/nav";
import { docsRoute } from "~/lib/shared";
import { getPageImageUrl, source } from "~/lib/source";
import { DocArticle } from "../../../_layout/article";

export default async function Page(props: PageProps<"/docs/[...slug]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const { previous, next } = findNeighbour(source.getPageTree(), page.url);
  const kernel = page.url.startsWith(`${docsRoute}/kernel/`);

  return (
    <DocArticle
      eyebrow={sectionFor(page.url)}
      title={page.data.title}
      lede={page.data.description}
      toc={page.data.toc}
      previous={previous}
      next={next}
      aside={
        kernel ? (
          <div className="doc-read">
            <a href={sourceUrl(KERNEL)} target="_blank" rel="noreferrer">
              packages/{KERNEL}
            </a>
            <span>
              read at{" "}
              <a
                href={`https://github.com/interfaces-lab/nyte/commit/${REVISION}`}
                target="_blank"
                rel="noreferrer"
              >
                {REVISION.slice(0, 7)}
              </a>
            </span>
          </div>
        ) : null
      }
    >
      <MDX components={docsMdxComponents()} />
    </DocArticle>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[...slug]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
