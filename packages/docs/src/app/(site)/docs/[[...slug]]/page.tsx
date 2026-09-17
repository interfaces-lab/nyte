import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { docsMdxComponents } from "~/components/mdx";
import { ShellMain } from "~/components/shell/column";
import { ShellHead } from "~/components/shell/head";
import { ShellPager } from "~/components/shell/pager";
import { docsSectionFor } from "~/lib/docs-nav";
import { docsRoute } from "~/lib/shared";
import { getPageImageUrl, source } from "~/lib/source";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  if (!params.slug || params.slug.length === 0) redirect(`${docsRoute}/design`);
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const section = docsSectionFor(page.url);
  const { previous, next } = findNeighbour(source.getPageTree(), page.url);

  return (
    <ShellMain skin="docs">
      <article className="docs-article">
        <ShellHead
          skin="docs"
          eyebrow={section}
          title={page.data.title}
          lede={page.data.description}
        />
        <div className="docs-prose">
          <MDX components={docsMdxComponents()} />
        </div>
        <ShellPager skin="docs" previous={previous} next={next} />
      </article>
    </ShellMain>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  if (!params.slug || params.slug.length === 0) return { title: "Docs" };
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
