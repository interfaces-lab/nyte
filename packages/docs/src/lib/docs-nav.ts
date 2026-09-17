import { foldNavGroups, navSectionFor, type NavGroup } from "./nav";
import { source } from "./source";

export function docsNavGroups(): NavGroup[] {
  return foldNavGroups(source.getPageTree().children);
}

/** The section label for a page, from the separator above it. */
export function docsSectionFor(url: string): string {
  return navSectionFor(docsNavGroups(), url);
}
