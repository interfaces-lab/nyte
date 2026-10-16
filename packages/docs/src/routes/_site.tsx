import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SiteNav } from "~/components/site-nav/site-nav";
import { latestMacRelease } from "~/lib/releases";

/* One navbar for every page. The document scrolls; the bar sticks at one offset. */
export const Route = createFileRoute("/_site")({
  loader: async () => ({ release: await latestMacRelease() }),
  staleTime: 60 * 60 * 1000,
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <>
      <SiteNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </>
  );
}
