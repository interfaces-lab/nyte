import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "../projects/page";

/** The first Stacks prototype, kept to compare against `/stacks`. */
export const Route = createFileRoute("/stacks-v1")({
  staticData: {
    prototype: {
      title: "Stacks v1",
      icon: "archive",
    },
  },
  component: ProjectsPage,
  head: () => ({
    meta: [{ title: "Lab · Stacks v1" }],
  }),
});
