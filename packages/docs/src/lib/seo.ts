import { appName, siteUrl } from "./shared";

interface PageMeta {
  title?: string;
  description?: string;
  /** A site path such as `/og/docs/image.png`; made absolute against the main host. */
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  /** Robots may index the page but should not follow its links either. */
  nofollow?: boolean;
  canonical?: string;
}

/** Head tags for one page. Titles read `Page · Nyte`; the root route supplies the defaults. */
export function pageHead(page: PageMeta) {
  const title = page.title ? `${page.title} · ${appName}` : undefined;
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
