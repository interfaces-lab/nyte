import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { docsMdxComponents } from "~/components/mdx";
import { ShellMain } from "~/components/shell/column";
import { ShellHead } from "~/components/shell/head";
import { ShellPager } from "~/components/shell/pager";
import { ShellToc } from "~/components/shell/toc";
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
    <>
      <ShellMain>
        <article className="shell-article">
          <ShellHead eyebrow={section} title={page.data.title} lede={page.data.description} />
          <div className="shell-prose">
            <MDX components={docsMdxComponents()} />
          </div>
          <ShellPager previous={previous} next={next} />
        </article>
      </ShellMain>
      <ShellToc entries={page.data.toc.filter((entry) => entry.depth <= 3)} />
    </>
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
