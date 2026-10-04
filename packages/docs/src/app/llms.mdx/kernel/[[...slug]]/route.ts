import { kernelSource, getKernelPageMarkdownUrl, getLLMText } from "~/lib/source";
import { notFound } from "next/navigation";

async function markdownFor(slug: string[] | undefined) {
  "use cache";

  const page = kernelSource.getPage(slug);
  if (!page) return null;

  return getLLMText(page);
}

export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/kernel/[[...slug]]">) {
  const { slug } = await params;
  const markdown = await markdownFor(slug?.slice(0, -1));
  if (markdown === null) notFound();

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  return kernelSource.getPages().map((page) => ({
    lang: page.locale,
    slug: getKernelPageMarkdownUrl(page).segments,
  }));
}
