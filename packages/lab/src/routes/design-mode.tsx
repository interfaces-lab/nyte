import { createFileRoute } from "@tanstack/react-router";
import { DesignModePage } from "../design-mode/page";
import site from "../design-mode/site.css?url";

export const Route = createFileRoute("/design-mode")({
  component: DesignModePage,
  head: () => ({
    meta: [{ title: "Lab · Design Mode" }],
    links: [{ rel: "stylesheet", href: site }],
  }),
});
