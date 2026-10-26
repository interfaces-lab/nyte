import { createFileRoute } from "@tanstack/react-router";
import { StacksPage } from "../stacks/page";

export const Route = createFileRoute("/stacks")({
  component: StacksPage,
  head: () => ({ meta: [{ title: "Lab · Stacks" }] }),
});
