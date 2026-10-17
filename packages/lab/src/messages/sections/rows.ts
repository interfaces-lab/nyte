import { type Section } from "../build";

export const rowsSection: Section = {
  id: "rows",
  title: "Transcript states",
  detail: "Rows that stand in for the transcript itself.",
  specimens: [
    {
      id: "row-loading",
      title: "Loading",
      source: "view = undefined · no turns",
      scene: { turns: [], loading: true },
    },
    {
      id: "row-error",
      title: "Couldn't load",
      source: "failed",
      scene: { turns: [], failed: true },
    },
  ],
};
