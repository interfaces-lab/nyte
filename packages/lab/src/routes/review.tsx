import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage } from "../review/page";

export const Route = createFileRoute("/review")({
  staticData: {
    prototype: {
      title: "Guided review",
      icon: "book",
    },
  },
  component: ReviewPage,
  head: () => ({ meta: [{ title: "Lab · Guided review" }] }),
});
