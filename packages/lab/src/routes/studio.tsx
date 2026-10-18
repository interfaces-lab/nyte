import { createFileRoute } from "@tanstack/react-router";
import { StudioPage } from "../../video/studio/page";

export const Route = createFileRoute("/studio")({
  component: StudioPage,
  head: () => ({ meta: [{ title: "Lab · Studio" }] }),
});
