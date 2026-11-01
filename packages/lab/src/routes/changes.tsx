import { createFileRoute } from "@tanstack/react-router";
import { ChangesPage } from "../changes/page";

export const Route = createFileRoute("/changes")({
  staticData: {
    prototype: {
      title: "Changes",
      icon: "diff",
    },
  },
  component: ChangesPage,
  head: () => ({ meta: [{ title: "Lab · Changes" }] }),
});
