import { createFileRoute } from "@tanstack/react-router";
import { serveEndpoint } from "../../../server/core.ts";

export const Route = createFileRoute("/core/endpoint")({
  server: { handlers: { GET: ({ request }) => serveEndpoint(request) } },
});
