import { createFileRoute } from "@tanstack/react-router";
import { StacksPage } from "../stacks/page";

export const Route = createFileRoute("/stacks")({
  staticData: {
    prototype: {
      title: "Stacks",
      icon: "layers",
    },
  },
  component: StacksPage,
  head: () => ({ meta: [{ title: "Lab · Stacks" }] }),
});
