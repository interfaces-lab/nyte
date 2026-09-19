import { cloudRoute, docsRoute } from "./shared";

export type SiteSectionId = "docs" | "cloud";

export type SiteFeatureIcon = "design" | "cloud";

export interface SiteFeature {
  href: string;
  title: string;
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
        icon: "cloud",
      },
    ],
  },
] as const satisfies readonly SiteSection[];
