import { createFileRoute } from "@tanstack/react-router";
import { serveCore } from "../../../server/core.ts";

export const Route = createFileRoute("/core/nyte/$")({
  server: { handlers: { ANY: ({ request }) => serveCore(request) } },
});
