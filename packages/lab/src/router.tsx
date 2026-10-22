import { createRouter, type AnyRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter(): AnyRouter {
  return createRouter({ routeTree, scrollRestoration: true });
}
