import { Outlet, createFileRoute } from "@tanstack/react-router";
import { DocFrame } from "~/components/site/frame";
import { docsNav } from "~/lib/docs";

export const Route = createFileRoute("/_site/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  return (
    <DocFrame sections={docsNav}>
      <Outlet />
    </DocFrame>
  );
}
