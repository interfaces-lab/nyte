import { createFileRoute } from "@tanstack/react-router";
import { PeekPage } from "../peek/page";

export const Route = createFileRoute("/peek")({
  staticData: {
    prototype: {
      title: "Peek",
      icon: "eye",
    },
  },
  component: PeekPage,
  head: () => ({
    meta: [{ title: "Lab · Peek" }],
  }),
});
