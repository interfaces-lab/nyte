import type { MetadataRoute } from "next";
import { allDocs } from "~/lib/docs";
import { siteUrl } from "~/lib/shared";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    { url: `${siteUrl}/privacy` },
    { url: `${siteUrl}/terms` },
    ...allDocs().map((page) => ({ url: `${siteUrl}${page.url}` })),
  ];
}
