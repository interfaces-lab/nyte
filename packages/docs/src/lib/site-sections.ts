import { cloudRoute, docsRoute } from "./shared";

export type SiteSectionId = "docs" | "cloud";

export type SiteFeatureIcon = "design" | "cloud";

export interface SiteFeature {
  href: string;
  title: string;
  description: string;
  icon: SiteFeatureIcon;
}

export interface SiteSection {
  id: SiteSectionId;
  label: string;
  href: string;
  features: readonly SiteFeature[];
}

/*
 * Featured destinations, not page trees. Family's Developers panel is two
 * product cards; the catalog lives in each product's own sidebar.
 */
export const SITE_SECTIONS = [
  {
    id: "docs",
    label: "Docs",
    href: `${docsRoute}/design`,
    features: [
      {
        href: `${docsRoute}/design`,
        title: "Design",
        description: "How core is put together: objects, refs, leases, and one event stream.",
        icon: "design",
      },
    ],
  },
  {
    id: "cloud",
    label: "Cloud",
    href: `${cloudRoute}/introduction`,
    features: [
      {
        href: `${cloudRoute}/introduction`,
        title: "Cloud",
        description: "The design system for web, desktop, and terminal.",
        icon: "cloud",
      },
    ],
  },
] as const satisfies readonly SiteSection[];
