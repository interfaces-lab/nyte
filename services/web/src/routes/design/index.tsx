import { createFileRoute, notFound } from "@tanstack/react-router";
import { DesignLanding } from "~/components/design-site/landing";
import { getDesignPage } from "~/lib/docs";
import { pageHead } from "~/lib/seo";
import { designName, designUrl } from "~/lib/shared";

export const Route = createFileRoute("/design/")({
  head: () => {
    const page = getDesignPage("");

    return pageHead({
      title: designName,
      site: designName,
      description: page?.description,
      image: page && `${designUrl}${page.imageUrl}`,
      type: "website",
      canonical: designUrl,
    });
  },
  component: DesignHome,
});

function DesignHome() {
  const page = getDesignPage("");

  if (!page) throw notFound();

  return <DesignLanding page={page} />;
}
