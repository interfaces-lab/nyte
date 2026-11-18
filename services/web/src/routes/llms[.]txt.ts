import { createFileRoute } from "@tanstack/react-router";
import { llmsIndex } from "~/lib/docs";

export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: () => new Response(llmsIndex()) } },
});
