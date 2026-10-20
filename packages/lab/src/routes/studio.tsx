import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { ComponentType, ReactElement } from "react";

const [loadStudio] = Object.values(
  import.meta.glob<{ readonly StudioPage: ComponentType }>("../../video/studio/page.tsx"),
);

const Studio =
  loadStudio === undefined
    ? undefined
    : lazy(async () => ({ default: (await loadStudio()).StudioPage }));

function StudioRoute(): ReactElement {
  if (Studio === undefined)
    return <p>The studio lives in packages/lab/video, which stays out of Git.</p>;

  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}

export const Route = createFileRoute("/studio")({
  component: StudioRoute,
  head: () => ({ meta: [{ title: "Lab · Studio" }] }),
});
