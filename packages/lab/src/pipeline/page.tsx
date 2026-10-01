import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { useLayoutEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Review } from "./review";

export function PipelinePage() {
  const theme = useRouterState({
    select: ({ location }) =>
      new URLSearchParams(location.searchStr).get("theme") === "light" ? "light" : "dark",
  });

  useLayoutEffect(() => {
    applyDisplayMode(theme === "dark" ? "dark" : "light");
  }, [theme]);

  return <Review />;
}
