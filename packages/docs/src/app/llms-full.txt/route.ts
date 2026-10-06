import { allDocs } from "~/lib/docs";

async function everyPage() {
  "use cache";

  const pages = await Promise.all(allDocs().map((page) => page.text()));

  return pages.join("\n\n");
}

export async function GET() {
  return new Response(await everyPage());
}
