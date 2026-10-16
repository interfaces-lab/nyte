import { Outlet, createFileRoute } from "@tanstack/react-router";
import { DocFrame } from "~/components/site/frame";
import { designNav } from "~/lib/docs";

export const Route = createFileRoute("/_site/design")({
  component: DesignLayout,
});

function DesignLayout() {
  return (
    <DocFrame sections={designNav}>
      <Outlet />
    </DocFrame>
  );
}
