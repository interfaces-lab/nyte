import { createFileRoute } from "@tanstack/react-router";
import { serveMcp } from "../../../server/mcp.ts";

export const Route = createFileRoute("/core/mcp/$")({
  server: { handlers: { ANY: ({ request, params }) => serveMcp(request, params._splat ?? "") } },
});
