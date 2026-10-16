import { createFileRoute } from "@tanstack/react-router";
import { Hero4 } from "~/components/landing/hero-4/hero-4";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";
import { pageHead } from "~/lib/seo";

export const Route = createFileRoute("/_site/_landing/hero-4")({
  head: () => pageHead({ noindex: true, nofollow: true, canonical: "https://nyte.sh" }),
  component: Hero4Page,
});

function Hero4Page() {
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
