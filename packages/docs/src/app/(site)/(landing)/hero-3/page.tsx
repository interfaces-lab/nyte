import type { Metadata } from "next";
import { HarnessArchive } from "~/components/landing/hero-3/harness-archive";
import { Hero3 } from "~/components/landing/hero-3/hero-3";
import { NavSentinel } from "~/components/landing/plate/nav-sentinel";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";

/* A candidate hero, served beside the landing page until one of them is deleted. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "https://nyte.sh" },
};

export default function Hero3Page() {
  return (
    <>
      <Hero3 />
      <div className="relative">
        <NavSentinel />
        <HarnessArchive />
      </div>
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section-lg pb-24">
        <InstallCard />
      </div>
      <SiteFooter />
    </>
  );
}
