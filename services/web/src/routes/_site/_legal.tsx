import { Outlet, createFileRoute } from "@tanstack/react-router";
import { DocFrame } from "~/components/site/frame";

export const Route = createFileRoute("/_site/_legal")({
  component: LegalLayout,
});

function LegalLayout() {
  return (
    <DocFrame
      sections={[
        {
          label: "Legal",
          items: [
            { title: "Privacy policy", href: "/privacy" },
            { title: "Terms of service", href: "/terms" },
          ],
        },
      ]}
    >
      <Outlet />
    </DocFrame>
  );
}
