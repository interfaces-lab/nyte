import { createFileRoute } from "@tanstack/react-router";
import { serveFootage } from "../../server/footage.ts";

export const Route = createFileRoute("/video/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveFootage(request, params._splat ?? ""),
      HEAD: ({ request, params }) => serveFootage(request, params._splat ?? ""),
    },
  },
});
