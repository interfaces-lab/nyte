import { createFileRoute } from "@tanstack/react-router";
import { ServerPage } from "../server/page";

export const Route = createFileRoute("/server")({
  staticData: {
    prototype: {
      title: "Server",
      icon: "server",
    },
  },
  component: ServerPage,
  head: () => ({ meta: [{ title: "Lab · Server" }] }),
});
