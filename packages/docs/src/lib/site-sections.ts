import { cloudRoute, docsRoute } from "./shared";

export type SiteSectionId = "docs" | "cloud";

export type SiteFeatureIcon = "docs" | "cloud";

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
    href: `${docsRoute}/composition`,
    features: [
      {
        href: `${docsRoute}/composition`,
        title: "Build an agent app",
        icon: "docs",
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
