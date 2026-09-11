import { cloudSource } from "./source";

export interface CloudNavItem {
  title: string;
  href: string;
}

export interface CloudNavGroup {
  label: string;
  items: CloudNavItem[];
}

/*
 * The sidebar model: Cloud's meta.json uses `---Label---` separators, so the
 * tree is a flat run of separators and pages. Folded into groups here so the
 * client sidebar receives plain data, not ReactNode names.
 */
export function cloudNavGroups(): CloudNavGroup[] {
  const groups: CloudNavGroup[] = [];
  let current: CloudNavGroup = { label: "", items: [] };
  for (const node of cloudSource.getPageTree().children) {
    if (node.type === "separator") {
      if (current.items.length > 0) groups.push(current);
      current = { label: typeof node.name === "string" ? node.name : "", items: [] };
      continue;
    }
    if (node.type === "page" && typeof node.name === "string") {
      current.items.push({ title: node.name, href: node.url });
    }
  }
  if (current.items.length > 0) groups.push(current);
  return groups;
}

/** The section label for a page, from the separator above it. */
export function cloudSectionFor(url: string): string {
  for (const group of cloudNavGroups()) {
    if (group.items.some((item) => item.href === url)) return group.label;
  }
  return "";
}
