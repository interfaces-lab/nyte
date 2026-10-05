import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { RequestsPage } from "./requests/page";
import { ReviewPage } from "./review/page";
import { SettingsPage } from "./settings/page";
import { UpdatesPage } from "./updates/page";
import { rootRoute } from "./routes/__root";

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
  return <ReviewPage initialReview={reviewRoute.useSearch().id} />;
}

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/requests" });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/requests",
    component: RequestsPage,
    head: () => ({ meta: [{ title: "Lab · Requests" }] }),
  }),
  reviewRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/updates",
    component: UpdatesPage,
    head: () => ({ meta: [{ title: "Lab · Updates" }] }),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsPage,
    head: () => ({ meta: [{ title: "Lab · Settings" }] }),
  }),
]);

export const router = createRouter({ routeTree, scrollRestoration: true });
