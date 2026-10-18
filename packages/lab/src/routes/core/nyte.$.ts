import { createFileRoute } from "@tanstack/react-router";
import { nyteHandler } from "../../../server/core.ts";

export const Route = createFileRoute("/core/nyte/$")({
  server: { handlers: { ANY: nyteHandler } },
});
