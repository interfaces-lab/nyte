import { notFound } from "next/navigation";
import { allDocs, getDoc } from "~/lib/docs";

async function markdownFor(slug: string[]) {
  "use cache";

  return (await getDoc(slug)?.text()) ?? null;
}

export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">) {
  const { slug = [] } = await params;
  if (slug.at(-1) !== "content.md") notFound();
  const markdown = await markdownFor(slug.slice(0, -1));
  if (markdown === null) notFound();

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  return allDocs().map((page) => ({ slug: [...page.slugs, "content.md"] }));
}
