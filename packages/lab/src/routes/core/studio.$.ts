import { createFileRoute } from "@tanstack/react-router";
import { studioHandler } from "../../../server/core.ts";

export const Route = createFileRoute("/core/studio/$")({
  server: { handlers: { ANY: studioHandler } },
});
