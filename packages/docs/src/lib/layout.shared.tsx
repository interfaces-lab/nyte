import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { DocsNavTitle } from "@/components/docs-nav-title";

/*
 * Options for DocsLayout. The navbar itself is <SiteNav /> in the root
 * layout, so the Fumadocs layout runs with its own off. The docs sidebar
 * drops its title for the same reason: the wordmark is already on the page,
 * one row up.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { enabled: false },
    themeSwitch: { enabled: false },
    slots: { navTitle: DocsNavTitle },
  };
}
