import { createFileRoute } from "@tanstack/react-router";
import { FlowSections } from "~/components/landing/flow/flow-sections";
import { Hero2 } from "~/components/landing/hero-2/hero-2";
import { InstallCard } from "~/components/landing/plate/install-card";
import { SiteFooter } from "~/components/landing/plate/site-footer";
import { pageHead } from "~/lib/seo";

export const Route = createFileRoute("/_site/_landing/hero-2")({
  head: () => pageHead({ noindex: true, nofollow: true, canonical: "https://nyte.sh" }),
  component: Hero2Page,
});

function Hero2Page() {
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
