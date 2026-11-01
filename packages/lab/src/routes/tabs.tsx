import { createFileRoute } from "@tanstack/react-router";
import { TabsPage } from "../tabs/page";

export const Route = createFileRoute("/tabs")({
  staticData: {
    prototype: {
      title: "Tabs",
      icon: "window-app",
    },
  },
  component: TabsPage,
  head: () => ({ meta: [{ title: "Lab · Tabs" }] }),
});
