import { createFileRoute } from "@tanstack/react-router";
import { allDesignPages, allDocs } from "~/lib/docs";
import { designPublicUrl } from "~/lib/hosts";
import { siteUrl } from "~/lib/shared";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = [
          siteUrl,
          `${siteUrl}/privacy`,
          `${siteUrl}/terms`,
          ...allDocs().map((page) => `${siteUrl}${page.url}`),
          ...allDesignPages().map((page) => designPublicUrl(page.url)),
        ];
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls.map((url) => `<url><loc>${url}</loc></url>`),
          "</urlset>",
        ].join("\n");
        return new Response(body, { headers: { "Content-Type": "application/xml" } });
      },
    },
  },
});
