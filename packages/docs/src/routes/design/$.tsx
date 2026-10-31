import { createFileRoute, notFound } from "@tanstack/react-router";
import { DesignNotFound } from "~/components/design-site/not-found";
import { DesignPageView } from "~/components/design-site/page";
import { getDesignPage } from "~/lib/docs";
import { designPublicUrl } from "~/lib/hosts";
import { pageHead } from "~/lib/seo";
import { designName, designUrl } from "~/lib/shared";

export const Route = createFileRoute("/design/$")({
  beforeLoad: ({ params }) => {
    if (!getDesignPage(params._splat)) throw notFound();
  },
  head: ({ params }) => {
    const page = getDesignPage(params._splat);

    if (!page) return {};

    return pageHead({
      title: page.title,
      site: designName,
      description: page.description,
      image: `${designUrl}${page.imageUrl}`,
      type: "article",
      canonical: designPublicUrl(page.url),
    });
  },
  component: DesignPage,
  notFoundComponent: DesignNotFound,
});

function DesignPage() {
  const page = getDesignPage(Route.useParams()._splat);

  if (!page) throw notFound();

  return <DesignPageView page={page} />;
}
