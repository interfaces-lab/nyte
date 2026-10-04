import { InstallCard } from "~/components/landing/plate/install-card";
import { PlateHero } from "~/components/landing/plate/plate-hero";
import { SiteFooter } from "~/components/landing/plate/site-footer";

export default function LandingPage() {
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
