import { createFileRoute } from "@tanstack/react-router";
import dialkit from "dialkit/styles.css?url";
import { ProjectsPage } from "../projects/page";

export const Route = createFileRoute("/stacks")({
  component: ProjectsPage,
  head: () => ({
    meta: [{ title: "Lab · Stacks" }],
    links: [{ rel: "stylesheet", href: dialkit }],
  }),
});
