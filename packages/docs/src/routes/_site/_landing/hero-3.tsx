import { createFileRoute } from "@tanstack/react-router";
import { HarnessArchive } from "~/components/landing/hero-3/harness-archive";
import { Hero3 } from "~/components/landing/hero-3/hero-3";
import { InstallCard } from "~/components/landing/plate/install-card";
import { NavSentinel } from "~/components/landing/plate/nav-sentinel";
import { SiteFooter } from "~/components/landing/plate/site-footer";
import { pageHead } from "~/lib/seo";

export const Route = createFileRoute("/_site/_landing/hero-3")({
  head: () => pageHead({ noindex: true, nofollow: true, canonical: "https://nyte.sh" }),
  component: Hero3Page,
});

function Hero3Page() {
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
