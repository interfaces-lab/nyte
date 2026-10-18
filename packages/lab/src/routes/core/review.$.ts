import { createFileRoute } from "@tanstack/react-router";
import { reviewHandler } from "../../../server/core.ts";

export const Route = createFileRoute("/core/review/$")({
  server: { handlers: { ANY: reviewHandler } },
});
