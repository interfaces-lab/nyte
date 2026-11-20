import { appName, siteUrl } from "./shared";

interface PageMeta {
  title?: string;
  site?: string;
  description?: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  nofollow?: boolean;
  canonical?: string;
}

export function pageHead(page: PageMeta) {
  const site = page.site ?? appName;
  const title = page.title && page.title !== site ? `${page.title} · ${site}` : page.title;
  const image = page.image ? new URL(page.image, siteUrl).href : undefined;
  const robots = [page.noindex && "noindex", page.nofollow && "nofollow"].filter(Boolean);

  return {
    meta: [
      ...(title ? [{ title }, { property: "og:title", content: page.title }] : []),
      ...(page.title ? [{ name: "twitter:title", content: page.title }] : []),
      ...(page.description
        ? [
            { name: "description", content: page.description },
            { property: "og:description", content: page.description },
            { name: "twitter:description", content: page.description },
          ]
        : []),
      ...(page.type ? [{ property: "og:type", content: page.type }] : []),
      ...(image
        ? [
            { property: "og:image", content: image },
            { name: "twitter:image", content: image },
          ]
        : []),
      ...(robots.length > 0 ? [{ name: "robots", content: robots.join(", ") }] : []),
    ],
    links: page.canonical ? [{ rel: "canonical", href: page.canonical }] : [],
  };
}
