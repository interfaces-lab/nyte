import { createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { EnvironmentsPage } from "./environments/page";
import { ReviewPage } from "./review/page";
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
      throw redirect({ to: "/environments" });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/environments",
    component: EnvironmentsPage,
    head: () => ({ meta: [{ title: "Lab · Environments" }] }),
  }),
  reviewRoute,
]);

export const router = createRouter({ routeTree, scrollRestoration: true });
