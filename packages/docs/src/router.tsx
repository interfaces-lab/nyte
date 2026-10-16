import { createRouter } from "@tanstack/react-router";
import { NotFound } from "~/components/site/not-found";
import { hostRewrite } from "~/lib/hosts";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    rewrite: hostRewrite,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
