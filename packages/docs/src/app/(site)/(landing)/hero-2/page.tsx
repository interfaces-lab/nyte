import type { Metadata } from "next";
import { Hero2 } from "~/components/landing/hero-2/hero-2";
import { FlowSections } from "~/components/landing/flow/flow-sections";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";

/* A candidate hero, served beside the landing page until one of them is deleted. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "https://nyte.sh" },
};

export default function Hero2Page() {
  return (
    <>
      <Hero2 />
      <FlowSections />
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section-lg pb-24">
        <InstallCard />
      </div>
      <SiteFooter />
    </>
  );
}
