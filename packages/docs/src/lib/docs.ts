import type * as PageTree from "fumadocs-core/page-tree";
import type { AdvancedIndex } from "fumadocs-core/search/server";
import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import type { MDXContent } from "mdx/types";
import type { TocEntry } from "~/components/site/sidebar";
import { designRoute, docsRoute } from "./shared";

/**
 * Each site's order lives in its content folder's `meta.json` files: the root
 * one lists pages and folders, `---Label---` starts a sidebar section, and
 * `...folder` inlines a folder in the order of its own `meta.json`.
 */
const docsContent = defineDocs({
  dir: "content/docs",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

const designContent = defineDocs({
  dir: "content/design",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

const docsSource = loader({ baseUrl: docsRoute, source: docsContent.toFumadocsSource() });

/** Design pages are flat, so `foundations/colors` is `/design/colors`. */
const designSource = loader({
  baseUrl: designRoute,
  source: designContent.toFumadocsSource(),
  slugs: (file) => {
    const parts = file.path.replace(/\.mdx$/, "").split("/");

    if (parts.length === 1) return parts[0] === "index" ? [] : parts;

    return parts.at(-1) === "index" ? parts.slice(-2, -1) : parts.slice(-1);
  },
});

type Source = typeof docsSource;

export interface NavItem {
  title: string;
  href: string;
}

export interface NavSection {
  label?: string;
  items: [NavItem, ...NavItem[]];
}

export interface DocPage {
  slugs: string[];
  url: string;
  title: string;
  description: string | undefined;
  Body: MDXContent;
  toc: TocEntry[];
  section: string | undefined;
  previous: NavItem | undefined;
  next: NavItem | undefined;
  imageUrl: string;
  markdownUrl: string;
  text: () => Promise<string>;
}

interface Site {
  pages: DocPage[];
  sections: NavSection[];
  searchIndexes: AdvancedIndex[];
  byPath: Map<string, DocPage>;
}

/** The page tree as sidebar sections: a separator starts one, and folders flatten into it. */
function readSections(tree: PageTree.Root): { label?: string; urls: string[] }[] {
  const sections: { label?: string; urls: string[] }[] = [{ urls: [] }];

  const visit = (nodes: readonly PageTree.Node[]) => {
    for (const node of nodes) {
      if (node.type === "separator") {
        sections.push({
          label: typeof node.name === "string" ? node.name : undefined,
          urls: [],
        });
      } else if (node.type === "page") {
        sections.at(-1)?.urls.push(node.url);
      } else {
        if (node.index) sections.at(-1)?.urls.push(node.index.url);
        visit(node.children);
      }
    }
  };

  visit(tree.children);

  return sections.filter((section) => section.urls.length > 0);
}

function build(source: Source): Site {
  const byUrl = new Map(source.getPages().map((page) => [page.url, page]));
  const sections = readSections(source.pageTree);

  const placed = sections.flatMap((section) =>
    section.urls.map((url) => {
      const page = byUrl.get(url);

      if (!page) throw new Error(`The page tree lists ${url}, which has no page`);
      byUrl.delete(url);

      return { page, section, item: { title: page.data.title, href: page.url } };
    }),
  );

  if (byUrl.size > 0)
    throw new Error(
      `Add to a meta.json: ${[...byUrl.values()].map((page) => page.path).join(", ")}`,
    );

  const pages = placed.map(({ page, section }, index): DocPage => ({
    slugs: page.slugs,
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    Body: page.data.body,
    toc: page.data.toc,
    section: section.label,
    previous: placed[index - 1]?.item,
    next: placed[index + 1]?.item,
    imageUrl: `/og${page.url}/image.png`,
    markdownUrl: `/llms.mdx${page.url}/content.md`,
    text: async () =>
      `# ${page.data.title} (${page.url})\n\n${await page.data.getText("processed")}`,
  }));

  return {
    pages,
    sections: sections.flatMap((section): NavSection[] => {
      const [first, ...rest] = placed.flatMap(({ section: placedIn, item }) => {
        if (placedIn !== section) return [];

        return [item.title === section.label ? { ...item, title: "Overview" } : item];
      });

      return first ? [{ label: section.label, items: [first, ...rest] }] : [];
    }),
    searchIndexes: placed.map(({ page }): AdvancedIndex => ({
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      structuredData: page.data.structuredData,
    })),
    byPath: new Map(pages.map((page) => [page.slugs.join("/"), page])),
  };
}

const docs = build(docsSource);

const design = build(designSource);

export const docsNav: readonly NavSection[] = docs.sections;

export const designNav: readonly NavSection[] = design.sections;

export function allDocs(): readonly DocPage[] {
  return docs.pages;
}

export function allDesignPages(): readonly DocPage[] {
  return design.pages;
}

export function getDoc(splat: string | undefined): DocPage | undefined {
  return docs.byPath.get(trimSlashes(splat));
}

export function getDesignPage(splat: string | undefined): DocPage | undefined {
  return design.byPath.get(trimSlashes(splat));
}

/** A page by its public path, such as `/docs/build/composition` or `/design/button`. */
export function findPage(path: string): DocPage | undefined {
  const [, site, ...rest] = path.split("/");
  const splat = rest.join("/");
  if (site === "docs") return getDoc(splat);
  if (site === "design") return getDesignPage(splat);
  return undefined;
}

function trimSlashes(splat: string | undefined): string {
  return (splat ?? "").replace(/^\/+|\/+$/g, "");
}

export function everyPage(): readonly DocPage[] {
  return [...docs.pages, ...design.pages];
}

export function searchIndexes(): AdvancedIndex[] {
  return [...docs.searchIndexes, ...design.searchIndexes];
}

export function llmsIndex(): string {
  return [
    "# Nyte",
    ...everyPage().map(
      (page) => `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`,
    ),
  ].join("\n");
}
