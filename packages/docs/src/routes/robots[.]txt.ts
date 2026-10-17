import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "~/lib/shared";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => new Response(`User-Agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`),
    },
  },
});
