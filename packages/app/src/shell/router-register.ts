import type { AppRouter } from "./routes.tsx";

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
