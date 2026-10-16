import { Outlet, createFileRoute } from "@tanstack/react-router";
import { editDiffHTML } from "~/components/landing/plate/hosts/edit-diff";

/*
 * The landing surface shares the site navbar and adds nothing above the
 * content. Its loader highlights the preview's diff on the server.
 */
export const Route = createFileRoute("/_site/_landing")({
  loader: async () => ({ editDiff: await editDiffHTML() }),
  staleTime: Infinity,
  component: LandingLayout,
});

function LandingLayout() {
  return (
    <div className="flex min-w-0 grow flex-col">
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
