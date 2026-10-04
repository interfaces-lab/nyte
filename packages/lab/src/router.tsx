import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { CorePage } from "./core/page";
import { CustomizePage } from "./customize/page";
import { EnvironmentsPage } from "./environments/page";
import { MoonPage } from "./moon/page";
import { ReviewPage } from "./review/page";
import { rootRoute } from "./routes/__root";
import { TabsPage } from "./tabs/page";

const ReviewSearch = Type.Object({ id: Type.Optional(Type.String()) });

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  validateSearch: (search): { readonly id?: string } =>
    Value.Check(ReviewSearch, search) ? search : {},
  component: ReviewRoute,
  head: () => ({ meta: [{ title: "Lab · Review" }] }),
});

function ReviewRoute(): ReactElement {
  const { id } = reviewRoute.useSearch();
  const navigate = reviewRoute.useNavigate();

  return (
    <ReviewPage
      id={id}
      onOpen={(next) => void navigate({ search: next === undefined ? {} : { id: next } })}
    />
  );
}

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
    path: "/tabs",
    component: TabsPage,
    head: () => ({ meta: [{ title: "Lab · Tabs" }] }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/customize",
    component: CustomizePage,
    head: () => ({ meta: [{ title: "Lab · Customize" }] }),
  }),
  reviewRoute,
]);

export const router = createRouter({ routeTree, scrollRestoration: true });
