import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import { CorePage } from "./core/page";
import { EnvironmentsPage } from "./environments/page";
import { MoonPage } from "./moon/page";
import { PipelinePage } from "./pipeline/page";
import { rootRoute } from "./routes/__root";

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/core" });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/core",
    component: CorePage,
    head: () => ({ meta: [{ title: "Lab · Core" }] }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/moon",
    component: MoonPage,
    head: () => ({ meta: [{ title: "Lab · Moon" }] }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/environments",
    component: EnvironmentsPage,
    head: () => ({ meta: [{ title: "Lab · Environments" }] }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/pipeline",
    component: PipelinePage,
    head: () => ({ meta: [{ title: "Lab · Pipeline" }] }),
  }),
]);

export const router = createRouter({ routeTree, scrollRestoration: true });
