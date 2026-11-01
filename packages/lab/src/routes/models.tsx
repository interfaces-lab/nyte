import { createFileRoute } from "@tanstack/react-router";
import { ModelsPage } from "../models/page";

export const Route = createFileRoute("/models")({
  staticData: {
    prototype: {
      title: "Model Picker",
      icon: "model-generic",
    },
  },
  component: ModelsPage,
  head: () => ({ meta: [{ title: "Lab · Model picker" }] }),
});
