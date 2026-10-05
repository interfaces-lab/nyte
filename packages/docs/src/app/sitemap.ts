import type { MetadataRoute } from "next";
import { source } from "~/lib/source";
import { siteUrl } from "~/lib/shared";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    { url: `${siteUrl}/privacy` },
    { url: `${siteUrl}/terms` },
    ...source.getPages().map((page) => ({ url: `${siteUrl}${page.url}` })),
  ];
}
