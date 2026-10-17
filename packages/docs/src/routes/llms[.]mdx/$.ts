import { createFileRoute } from "@tanstack/react-router";
import { findPage } from "~/lib/docs";

/** `/llms.mdx/docs/build/composition/content.md` is that page as Markdown. */
export const Route = createFileRoute("/llms.mdx/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat ?? "";
        const page = splat.endsWith("/content.md")
          ? findPage(`/${splat.slice(0, -"/content.md".length)}`)
          : undefined;
        if (!page) return new Response("Not found", { status: 404 });
        return new Response(await page.text(), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      },
    },
  },
});
