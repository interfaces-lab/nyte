import type { AdvancedIndex } from "fumadocs-core/search/server";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineCollections } from "fumadocs-mdx/macro";
import type { MDXContent } from "mdx/types";
import type { TocEntry } from "~/components/site/toc";
import { designRoute, docsRoute } from "./shared";

const docsCollection = defineCollections({
  type: "doc",
  dir: "content/docs",
  schema: pageSchema,
  postprocess: {
    includeProcessedMarkdown: true,
  },
});

const designCollection = defineCollections({
  type: "doc",
  dir: "content/design",
  schema: pageSchema,
  postprocess: {
    includeProcessedMarkdown: true,
  },
});

type Entry = (typeof docsCollection.entries)[number];

interface Section {
  label?: string;
  files: string[];
}

const docsOutline: Section[] = [{ files: ["index", "remote-access", "build/composition"] }];

const designOutline: Section[] = [
  { files: ["index"] },
  {
    label: "Foundations",
    files: [
      "foundations/colors",
      "foundations/radius",
      "foundations/spacing",
      "foundations/typography",
      "foundations/shadows",
      "foundations/motion",
      "foundations/tokens",
      "foundations/theming",
      "foundations/focus",
      "foundations/icons",
    ],
  },
  {
    label: "Components",
    files: [
      "components/index",
      "components/alert-dialog",
      "components/autocomplete",
      "components/attachment",
      "components/avatar",
      "components/bubble",
      "components/button",
      "components/chart",
      "components/checkbox",
      "components/collapsible",
      "components/command",
      "components/context-menu",
      "components/dialog",
      "components/icon",
      "components/input",
      "components/kbd",
      "components/marker",
      "components/menu",
      "components/message",
      "components/message-scroller",
      "components/meter",
      "components/number-field",
      "components/popover",
      "components/preview-card",
      "components/questionnaire",
      "components/row",
      "components/select",
      "components/slider",
      "components/spinner",
      "components/switch",
      "components/tabs",
      "components/textarea",
      "components/toast",
      "components/toggle",
      "components/toggle-group",
      "components/toolbar",
      "components/tooltip",
    ],
  },
];

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

/* Docs pages nest by folder; design pages are flat, so `foundations/colors` is `/design/colors`. */
function nestedSlugs(file: string): string[] {
  const parts = file.split("/");
  return parts.at(-1) === "index" ? parts.slice(0, -1) : parts;
}

function flatSlugs(file: string): string[] {
  if (file === "index") return [];
  const parts = file.split("/");
  return parts.at(-1) === "index" ? parts.slice(0, -1) : parts.slice(-1);
}

function build(
  route: string,
  outline: Section[],
  collectionEntries: readonly Entry[],
  slugsFor: (file: string) => string[],
): Site {
  const entries = new Map(
    collectionEntries.map((entry) => [entry.info.path.replace(/\.mdx$/, ""), entry]),
  );
  const placed = outline.flatMap((section) =>
    section.files.map((file) => {
      const entry = entries.get(file);
      if (!entry) throw new Error(`The ${route} outline lists ${file}, which has no MDX file`);
      entries.delete(file);
      const slugs = slugsFor(file);
      const item: NavItem = { title: entry.title, href: [route, ...slugs].join("/") };
      return { entry, section, slugs, item };
    }),
  );
  if (entries.size > 0)
    throw new Error(`Add to the ${route} outline: ${[...entries.keys()].join(", ")}`);

  const pages = placed.map(({ entry, section, slugs, item }, index): DocPage => ({
    slugs,
    url: item.href,
    title: entry.title,
    description: entry.description,
    Body: entry.body,
    toc: entry.toc,
    section: section.label,
    previous: placed[index - 1]?.item,
    next: placed[index + 1]?.item,
    imageUrl: `/og${item.href}/image.png`,
    markdownUrl: `/llms.mdx${item.href}/content.md`,
    text: async () => `# ${entry.title} (${item.href})\n\n${await entry.getText("processed")}`,
  }));

  const sections = outline.map((section): NavSection => {
    const [first, ...rest] = placed
      .filter((page) => page.section === section)
      .map((page) => page.item);
    if (!first) throw new Error(`The ${route} outline section ${section.label} is empty`);
    return { label: section.label, items: [first, ...rest] };
  });

  const searchIndexes = placed.map(({ entry, item }): AdvancedIndex => ({
    id: item.href,
    url: item.href,
    title: entry.title,
    description: entry.description,
    structuredData: entry.structuredData,
  }));

  return {
    pages,
    sections,
    searchIndexes,
    byPath: new Map(pages.map((page) => [page.slugs.join("/"), page])),
  };
}

const docs = build(docsRoute, docsOutline, docsCollection.entries, nestedSlugs);
const design = build(designRoute, designOutline, designCollection.entries, flatSlugs);

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
