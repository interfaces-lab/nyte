import { createFileRoute } from "@tanstack/react-router";
import dialkit from "dialkit/styles.css?url";
import { PeekPage } from "../peek/page";

export const Route = createFileRoute("/peek")({
  component: PeekPage,
  head: () => ({
    meta: [{ title: "Lab · Peek" }],
    links: [{ rel: "stylesheet", href: dialkit }],
  }),
});
