import type { AdvancedIndex } from "fumadocs-core/search/server";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineCollections } from "fumadocs-mdx/macro";
import type { MDXContent } from "mdx/types";
import type { TocEntry } from "~/app/(site)/_layout/toc";
import { KERNEL } from "~/components/mdx/kernel/source";
import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";

const collection = defineCollections({
  type: "doc",
  dir: "content/docs",
  schema: pageSchema,
  postprocess: {
    includeProcessedMarkdown: true,
  },
});

interface Section {
  /** Unlabelled sections sit at the top of the sidebar. */
  label?: string;
  /** Package path the pages were read against, shown under the table of contents. */
  source?: string;
  files: string[];
}

/* Editorial order. Every MDX file under content/docs appears here exactly once. */
const outline: Section[] = [
  { files: ["index", "build/composition"] },
  { label: "Kernel", source: KERNEL, files: ["kernel/architecture", "kernel/life-of-a-message"] },
  {
    label: "Runtime",
    source: KERNEL,
    files: [
      "kernel/runner",
      "kernel/step",
      "kernel/inbox",
      "kernel/admission",
      "kernel/respond",
      "kernel/tools",
      "kernel/stop",
      "kernel/heads",
      "kernel/events",
      "kernel/plugins",
      "kernel/agents",
    ],
  },
  { label: "Storage", source: KERNEL, files: ["kernel/store", "kernel/refs", "kernel/objects"] },
  {
    label: "Reference",
    source: KERNEL,
    files: ["kernel/constants", "kernel/functions", "kernel/open-issues", "kernel/quiz"],
  },
  {
    label: "Foundations",
    files: [
      "components/introduction",
      "components/foundations/tokens",
      "components/foundations/theming",
      "components/foundations/focus",
      "components/foundations/icons",
    ],
  },
  {
    label: "Components",
    files: [
      "components/components/index",
      "components/components/alert-dialog",
      "components/components/autocomplete",
      "components/components/attachment",
      "components/components/avatar",
      "components/components/bubble",
      "components/components/button",
      "components/components/checkbox",
      "components/components/collapsible",
      "components/components/command",
      "components/components/context-menu",
      "components/components/dialog",
      "components/components/icon",
      "components/components/input",
      "components/components/kbd",
      "components/components/marker",
      "components/components/menu",
      "components/components/message",
      "components/components/message-scroller",
      "components/components/number-field",
      "components/components/popover",
      "components/components/preview-card",
      "components/components/questionnaire",
      "components/components/row",
      "components/components/select",
      "components/components/slider",
      "components/components/spinner",
      "components/components/switch",
      "components/components/tabs",
      "components/components/textarea",
      "components/components/toast",
      "components/components/toggle",
      "components/components/toggle-group",
      "components/components/toolbar",
      "components/components/tooltip",
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
  source: string | undefined;
  previous: NavItem | undefined;
  next: NavItem | undefined;
  imageUrl: string;
  markdownUrl: string;
  /** Title, URL, and processed Markdown, for the llms routes. */
  text: () => Promise<string>;
}

function slugsOf(file: string): string[] {
  const parts = file.split("/");
  return parts.at(-1) === "index" ? parts.slice(0, -1) : parts;
}

function build() {
  const entries = new Map(
    collection.entries.map((entry) => [entry.info.path.replace(/\.mdx$/, ""), entry]),
  );
  const placed = outline.flatMap((section) =>
    section.files.map((file) => {
      const entry = entries.get(file);
      if (!entry) throw new Error(`The docs outline lists ${file}, which has no MDX file`);
      entries.delete(file);
      const slugs = slugsOf(file);
      const item: NavItem = { title: entry.title, href: [docsRoute, ...slugs].join("/") };
      return { entry, section, slugs, item };
    }),
  );
  if (entries.size > 0)
    throw new Error(`Add to the docs outline: ${[...entries.keys()].join(", ")}`);

  const pages = placed.map(({ entry, section, slugs, item }, index): DocPage => ({
    slugs,
    url: item.href,
    title: entry.title,
    description: entry.description,
    Body: entry.body,
    toc: entry.toc,
    section: section.label,
    source: section.source,
    previous: placed[index - 1]?.item,
    next: placed[index + 1]?.item,
    imageUrl: [docsImageRoute, ...slugs, "image.png"].join("/"),
    markdownUrl: [docsContentRoute, ...slugs, "content.md"].join("/"),
    text: async () => `# ${entry.title} (${item.href})\n\n${await entry.getText("processed")}`,
  }));

  const sections = outline.map((section): NavSection => {
    const [first, ...rest] = placed
      .filter((page) => page.section === section)
      .map((page) => page.item);
    if (!first) throw new Error(`The docs outline section ${section.label} is empty`);
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

const docs = build();

export const docsNav: readonly NavSection[] = docs.sections;

export function allDocs(): readonly DocPage[] {
  return docs.pages;
}

export function getDoc(slugs: readonly string[] | undefined): DocPage | undefined {
  return docs.byPath.get((slugs ?? []).join("/"));
}

export function searchIndexes(): AdvancedIndex[] {
  return docs.searchIndexes;
}

export function llmsIndex(): string {
  return [
    "# Nyte",
    ...docs.pages.map(
      (page) => `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`,
    ),
  ].join("\n");
}
