import type { Metadata } from "next";
import { Hero4 } from "~/components/landing/hero-4/hero-4";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";

/* A candidate hero, served beside the landing page until one of them is deleted. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "https://nyte.sh" },
};

export default function Hero4Page() {
  return (
    <>
      <Hero4 />
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section-lg pb-24">
        <InstallCard />
      </div>
      <SiteFooter />
    </>
  );
}
