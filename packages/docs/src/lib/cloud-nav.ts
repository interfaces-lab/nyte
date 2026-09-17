import { foldNavGroups, navSectionFor, type NavGroup } from "./nav";
import { cloudSource } from "./source";

/*
 * Cloud's meta.json uses `---Label---` separators, so the tree is a flat run
 * of separators and pages. Folded into groups so the sidebar can render
 * Overview pages and labeled folders, not a dumped catalog.
 */
export function cloudNavGroups(): NavGroup[] {
  return foldNavGroups(cloudSource.getPageTree().children);
}

/** The section label for a page, from the separator above it. */
export function cloudSectionFor(url: string): string {
  return navSectionFor(cloudNavGroups(), url);
}
