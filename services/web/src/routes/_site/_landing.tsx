import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_site/_landing")({
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
