import { docsRoute } from "./shared";

export type SiteFeatureIcon = "start" | "build" | "kernel" | "components";

export interface SiteFeature {
  href: string;
  title: string;
  icon: SiteFeatureIcon;
}

export interface SiteSection {
  id: string;
  label: string;
  href: string;
  features: readonly SiteFeature[];
}

/* One section. Its panel lists the four groups of the docs sidebar. */
export const SITE_SECTIONS = [
  {
    id: "docs",
    label: "Docs",
    href: docsRoute,
    features: [
      { href: `${docsRoute}/start/overview`, title: "Start", icon: "start" },
      { href: `${docsRoute}/build/composition`, title: "Build", icon: "build" },
      { href: `${docsRoute}/kernel/architecture`, title: "Kernel", icon: "kernel" },
      { href: `${docsRoute}/components/introduction`, title: "Components", icon: "components" },
    ],
  },
] as const satisfies readonly SiteSection[];
