export interface NavItem {
  title: string;
  href: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface PageTreeChild {
  type: string;
  name?: unknown;
  url?: string;
}

/*
 * Separators in meta.json become group labels so the sidebar receives
 * plain data, not ReactNode names. Both doc sections fold identically.
 */
export function foldNavGroups(children: PageTreeChild[]): NavGroup[] {
  const groups: NavGroup[] = [];
  let current: NavGroup = { label: "", items: [] };
  for (const node of children) {
    if (node.type === "separator") {
      if (current.items.length > 0) groups.push(current);
      current = { label: typeof node.name === "string" ? node.name : "", items: [] };
      continue;
    }
    if (node.type === "page" && typeof node.name === "string" && typeof node.url === "string") {
      current.items.push({ title: node.name, href: node.url });
    }
  }
  if (current.items.length > 0) groups.push(current);
  return groups;
}

/** The section label for a page, from the separator above it. */
export function navSectionFor(groups: NavGroup[], url: string): string {
  for (const group of groups) {
    if (group.items.some((item) => item.href === url)) return group.label;
  }
  return "";
}
