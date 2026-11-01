import { createRouter, type AnyRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import type { Prototype } from "./shell/layout";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Lists the route in the lab's rail. */
    readonly prototype?: Prototype;
  }
}

export function getRouter(): AnyRouter {
  return createRouter({ routeTree, scrollRestoration: true });
}
