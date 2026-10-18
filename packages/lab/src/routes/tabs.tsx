import { createFileRoute } from "@tanstack/react-router";
import { TabsPage } from "../tabs/page";

export const Route = createFileRoute("/tabs")({
  component: TabsPage,
  head: () => ({ meta: [{ title: "Lab · Tabs" }] }),
});
