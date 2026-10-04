import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docsMdxComponents } from "~/components/mdx";
import { kernelSectionFor } from "~/lib/kernel-nav";
import { kernelSource } from "~/lib/source";
import { KernelHeader } from "~/components/mdx/kernel/header";
import { DocArticle } from "../../_layout/article";

export default async function Page(props: PageProps<"/kernel/[[...slug]]">) {
  const params = await props.params;
  const page = kernelSource.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const section = kernelSectionFor(page.url);
  const { previous, next } = findNeighbour(kernelSource.getPageTree(), page.url);

  return (
    <DocArticle
      eyebrow={section}
      title={page.data.title}
      lede={page.data.description}
      actions={<KernelHeader />}
      toc={page.data.toc}
      previous={previous}
      next={next}
    >
      <MDX components={docsMdxComponents()} />
    </DocArticle>
  );
}

export async function generateStaticParams() {
  return kernelSource.generateParams();
}

export async function generateMetadata(props: PageProps<"/kernel/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = kernelSource.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
