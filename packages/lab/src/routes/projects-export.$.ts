import { createFileRoute } from "@tanstack/react-router";
import { serveProjectsExport } from "../../server/projects-export.ts";

export const Route = createFileRoute("/projects-export/$")({
  server: { handlers: { GET: ({ params }) => serveProjectsExport(params._splat ?? "") } },
});
