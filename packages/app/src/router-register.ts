import type { AppRouter } from "./router.tsx";

/** Registers the app's routes for the app's own program only. Nothing imports this file, so a program that compiles app sources through imports, such as the lab's, keeps its routes untyped instead of clashing with its own. */
declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
