import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cloudMdxComponents } from "~/components/cloud/mdx";
import { cloudSectionFor } from "~/lib/cloud-nav";
import { cloudRoute } from "~/lib/shared";
import { cloudSource } from "~/lib/source";
import { DocArticle } from "../../_layout/article";

export default async function Page(props: PageProps<"/cloud/[[...slug]]">) {
  const params = await props.params;
  // /cloud has no index page of its own; the design system opens on Introduction.
  if (!params.slug || params.slug.length === 0) redirect(`${cloudRoute}/introduction`);
  const page = cloudSource.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const landing = page.url === `${cloudRoute}/introduction`;
  const section = cloudSectionFor(page.url);
  const { previous, next } = findNeighbour(cloudSource.getPageTree(), page.url);

  return (
    <DocArticle
      eyebrow={section}
      title={landing ? "Cloud" : page.data.title}
      lede={page.data.description}
      actions={
        landing ? (
          <div className="cloud-cta">
            <Link className="cloud-cta-primary" href={`${cloudRoute}/foundations/tokens`}>
              Get started
              <span aria-hidden>→</span>
            </Link>
            <Link className="cloud-cta-secondary" href={`${cloudRoute}/components/button`}>
              Try it out
            </Link>
          </div>
        ) : null
      }
      toc={page.data.toc}
      previous={previous}
      next={next}
    >
      <MDX components={cloudMdxComponents()} />
    </DocArticle>
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

  if (page.url === `${cloudRoute}/introduction`) {
    return {
      title: "Cloud",
      description: page.data.description,
    };
  }

  return {
    title: `${page.data.title} — Cloud`,
    description: page.data.description,
  };
}
