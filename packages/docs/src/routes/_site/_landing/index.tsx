import { createFileRoute } from "@tanstack/react-router";
import { CoreMosaic } from "~/components/landing/hero-5/core-mosaic";
import { Hero5 } from "~/components/landing/hero-5/hero-5";
import { ProductCards } from "~/components/landing/hero-5/product-cards";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";

export const Route = createFileRoute("/_site/_landing/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <>
      <Hero5 />
      <CoreMosaic />
      <ProductCards />
      <div className="mx-auto w-[min(100%,var(--site-inner))] px-(--site-pad) pt-section pb-24">
        <InstallCard />
      </div>
      <SiteFooter />
    </>
  );
}
