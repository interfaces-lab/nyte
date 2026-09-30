import { useLayoutEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Review } from "./review";

export function PipelinePage() {
  const theme = useRouterState({
    select: ({ location }) =>
      new URLSearchParams(location.searchStr).get("theme") === "light" ? "light" : "dark",
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.displayMode = theme;
  }, [theme]);

  return <Review />;
}
