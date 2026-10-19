import { createFileRoute } from "@tanstack/react-router";
import { HubsPage } from "../hubs/page";

export const Route = createFileRoute("/hubs")({
  component: HubsPage,
  head: () => ({ meta: [{ title: "Lab · Settings hubs" }] }),
});
