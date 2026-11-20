import { createFileRoute } from "@tanstack/react-router";
import { findPage } from "~/lib/docs";

export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat ?? "";
        const page = splat.endsWith("/content.md")
          ? findPage(`/${splat.slice(0, -"/content.md".length)}`)
          : undefined;
        if (!page)
          return new Response(
            "Page not found. Find a page path in /llms.txt, then request /llms.mdx/<path>/content.md (for example, /llms.mdx/docs/content.md).",
            { status: 404 },
          );
        return new Response(await page.text(), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      },
    },
  },
});
