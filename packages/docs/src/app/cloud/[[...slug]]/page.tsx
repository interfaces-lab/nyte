import Link from "next/link";
import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cloudMdxComponents } from "~/components/cloud/mdx";
import { CloudToc } from "~/components/cloud/shell/toc";
import { cloudSectionFor } from "~/lib/cloud-nav";
import { cloudRoute } from "~/lib/shared";
import { cloudSource, getCloudPageMarkdownUrl } from "~/lib/source";

export default async function Page(props: PageProps<"/cloud/[[...slug]]">) {
  const params = await props.params;
  // /cloud has no index page of its own; the design system opens on Introduction.
  if (!params.slug || params.slug.length === 0) redirect(`${cloudRoute}/introduction`);
  const page = cloudSource.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getCloudPageMarkdownUrl(page).url;
  const section = cloudSectionFor(page.url);
  const { previous, next } = findNeighbour(cloudSource.getPageTree(), page.url);
  // Heading titles arrive as rendered elements (inline code survives), so they
  // pass through to the client rail as-is.
  const toc = page.data.toc
    .filter((entry) => entry.depth <= 3)
    .map((entry) => ({ title: entry.title, url: entry.url, depth: entry.depth }));

  return (
    <>
      <main className="cloud-main">
        <article className="cloud-article">
          <header className="cloud-head">
            {section && <span className="cloud-eyebrow">{section}</span>}
            <h1 className="cloud-title">{page.data.title}</h1>
            {page.data.description && <p className="cloud-lede">{page.data.description}</p>}
            <div className="cloud-head-actions">
              <a className="cloud-pill" href={markdownUrl}>
                View as Markdown
              </a>
            </div>
          </header>
          <div className="cloud-prose">
            <MDX components={cloudMdxComponents()} />
          </div>
          {(previous || next) && (
            <nav className="cloud-pager" aria-label="Pages">
              {previous && typeof previous.name === "string" && (
                <Link href={previous.url} data-dir="previous">
                  <span className="cloud-eyebrow">Previous</span>
                  <strong>{previous.name}</strong>
                </Link>
              )}
              {next && typeof next.name === "string" && (
                <Link href={next.url} data-dir="next">
                  <span className="cloud-eyebrow">Next</span>
                  <strong>{next.name}</strong>
                </Link>
              )}
            </nav>
          )}
        </article>
      </main>
      <CloudToc entries={toc} />
    </>
  );
}

export async function generateStaticParams() {
  return cloudSource.generateParams();
}

export async function generateMetadata(props: PageProps<"/cloud/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  if (!params.slug || params.slug.length === 0) return { title: "Cloud" };
  const page = cloudSource.getPage(params.slug);
  if (!page) notFound();

  return {
    title: `${page.data.title} — Cloud`,
    description: page.data.description,
  };
}
