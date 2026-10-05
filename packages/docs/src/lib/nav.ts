import { source } from "./source";

export interface NavItem {
  title: string;
  href: string;
  /** The sub-group label this page sits under, when the group has any. */
  sub?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface PageTreeChild {
  type: string;
  name?: unknown;
  url?: string;
  children?: PageTreeChild[];
  index?: { url?: string; name?: unknown };
}

/*
 * One top-level folder per group. Inside a group, a separator names a
 * sub-group and a nested folder is one too; pages flatten into the group
 * carrying that label, so the sidebar receives plain data.
 */
function foldGroup(folder: PageTreeChild): NavGroup {
  const label = typeof folder.name === "string" ? folder.name : "";
  const items: NavItem[] = [];
  if (folder.index && typeof folder.index.url === "string") {
    const name = folder.index.name;
    items.push({ title: typeof name === "string" ? name : label, href: folder.index.url });
  }
  const walk = (children: PageTreeChild[], sub: string | undefined) => {
    let current = sub;
    for (const node of children) {
      if (node.type === "separator") {
        current = typeof node.name === "string" ? node.name : undefined;
        continue;
      }
      if (node.type === "folder") {
        const name = typeof node.name === "string" ? node.name : current;
        if (node.index && typeof node.index.url === "string") {
          const title = node.index.name;
          items.push({
            title: typeof title === "string" ? title : (name ?? ""),
            href: node.index.url,
            sub: name,
          });
        }
        walk(node.children ?? [], name);
        continue;
      }
      if (node.type === "page" && typeof node.name === "string" && typeof node.url === "string") {
        items.push({ title: node.name, href: node.url, sub: current });
      }
    }
  };
  walk(folder.children ?? [], undefined);
  return { label, items };
}

export function navGroups(): NavGroup[] {
  const children: PageTreeChild[] = source.getPageTree().children;
  return children.filter((node) => node.type === "folder").map(foldGroup);
}

/** "Group · Sub-group" for a page, from where it sits in the tree. */
export function sectionFor(url: string): string {
  for (const group of navGroups()) {
    const item = group.items.find((candidate) => candidate.href === url);
    if (item) return item.sub ? `${group.label} · ${item.sub}` : group.label;
  }
  return "";
}
