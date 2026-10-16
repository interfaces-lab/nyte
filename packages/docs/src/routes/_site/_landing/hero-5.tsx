import { createFileRoute } from "@tanstack/react-router";
import { InstallCard } from "~/components/landing/plate/install-card";
import { PlateHero } from "~/components/landing/plate/plate-hero";
import { SiteFooter } from "~/components/landing/plate/site-footer";
import { pageHead } from "~/lib/seo";

export const Route = createFileRoute("/_site/_landing/hero-5")({
  head: () => pageHead({ noindex: true, nofollow: true, canonical: "https://nyte.sh" }),
  component: Hero5Page,
});

function Hero5Page() {
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
