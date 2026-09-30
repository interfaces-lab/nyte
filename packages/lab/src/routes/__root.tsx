import { HeadContent, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, type ReactElement } from "react";
import { LabNav } from "../shell/lab-nav";
import type { router } from "../router";

function LabLayout(): ReactElement {
  const page = useRouterState<typeof router, string>({
    select: ({ matches }) => matches.at(-1)?.routeId ?? "/",
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.labPage = page;
  }, [page]);

  return (
    <>
      <HeadContent />
      <Outlet />
      <LabNav />
    </>
  );
}

export const rootRoute = createRootRoute({ component: LabLayout });
