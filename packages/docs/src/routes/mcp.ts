import { createFileRoute } from "@tanstack/react-router";
import { answerMcp } from "~/lib/docs-mcp";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => answerMcp(request),
      POST: ({ request }) => answerMcp(request),
      DELETE: ({ request }) => answerMcp(request),
    },
  },
});
