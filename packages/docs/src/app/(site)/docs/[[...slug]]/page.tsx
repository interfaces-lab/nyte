import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mdxComponents } from "~/components/mdx";
import { REVISION, sourceUrl } from "~/components/mdx/kernel/source";
import { allDocs, getDoc } from "~/lib/docs";
import { DocArticle } from "../../_layout/article";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await props.params;
  const page = getDoc(slug);
  if (!page) notFound();

  return (
    <DocArticle
      eyebrow={page.section}
      title={page.title}
      lede={page.description}
      toc={page.toc}
      previous={page.previous}
      next={page.next}
      aside={
        page.source ? (
          <div className="doc-read">
            <a href={sourceUrl(page.source)} target="_blank" rel="noreferrer">
              packages/{page.source}
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
      <page.Body components={mdxComponents} />
    </DocArticle>
  );
}

export function generateStaticParams() {
  return allDocs().map((page) => ({ slug: page.slugs }));
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await props.params;
  const page = getDoc(slug);
  if (!page) notFound();

  return {
    title: page.title,
    description: page.description,
    openGraph: {
      images: page.imageUrl,
    },
  };
}
