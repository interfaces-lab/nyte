import type { Metadata } from "next";
import { InstallCard } from "~/components/landing/plate/install-card";
import { PlateHero } from "~/components/landing/plate/plate-hero";
import { SiteFooter } from "~/components/landing/plate/site-footer";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: "https://nyte.sh" },
};

export default function Hero5Page() {
  return (
    <>
      <PlateHero />
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-12 pb-24">
        <InstallCard />
      </div>
      <SiteFooter />
    </>
  );
}
