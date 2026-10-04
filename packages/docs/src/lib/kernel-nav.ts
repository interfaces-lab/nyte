import { foldNavGroups, navSectionFor, type NavGroup } from "./nav";
import { kernelSource } from "./source";

export function kernelNavGroups(): NavGroup[] {
  return foldNavGroups(kernelSource.getPageTree().children);
}

export function kernelSectionFor(url: string): string {
  return navSectionFor(kernelNavGroups(), url);
}
