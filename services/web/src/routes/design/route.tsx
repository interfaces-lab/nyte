import { Outlet, createFileRoute } from "@tanstack/react-router";
import { DesignShell } from "~/components/design-site/shell";
import { getDesignPage } from "~/lib/docs";
import { designName, designUrl } from "~/lib/shared";

const card = `${designUrl}/og/design/image.png`;

export const Route = createFileRoute("/design")({
  head: () => {
    const summary = getDesignPage("")?.description ?? designName;

    return {
      meta: [
        { title: designName },
        { name: "description", content: summary },
        { name: "application-name", content: designName },
        { property: "og:site_name", content: designName },
        { property: "og:title", content: designName },
        { property: "og:description", content: summary },
        { property: "og:image", content: card },
        { name: "twitter:title", content: designName },
        { name: "twitter:description", content: summary },
        { name: "twitter:image", content: card },
      ],
    };
  },
  component: DesignLayout,
});

function DesignLayout() {
  return (
    <DesignShell>
      <Outlet />
    </DesignShell>
  );
}
