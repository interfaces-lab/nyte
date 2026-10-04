import type { MetadataRoute } from "next";
import { kernelSource, cloudSource, source } from "~/lib/source";
import { siteUrl } from "~/lib/shared";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl },
    ...[...source.getPages(), ...cloudSource.getPages(), ...kernelSource.getPages()].map(
      (page) => ({
        url: `${siteUrl}${page.url}`,
      }),
    ),
  ];
}
