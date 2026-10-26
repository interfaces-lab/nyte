import { createFileRoute } from "@tanstack/react-router";
import dialkit from "dialkit/styles.css?url";
import { ProjectsPage } from "../projects/page";

/** The first Stacks prototype, kept to compare against `/stacks`. */
export const Route = createFileRoute("/stacks-v1")({
  component: ProjectsPage,
  head: () => ({
    meta: [{ title: "Lab · Stacks v1" }],
    links: [{ rel: "stylesheet", href: dialkit }],
  }),
});
