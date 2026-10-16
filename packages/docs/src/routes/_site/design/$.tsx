import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocPageView, docPageHead } from "~/components/site/doc-page";
import { DocFrame } from "~/components/site/frame";
import { designNav, getDesignPage } from "~/lib/docs";
import { designPublicUrl } from "~/lib/hosts";

export const Route = createFileRoute("/_site/design/$")({
  beforeLoad: ({ params }) => {
    if (!getDesignPage(params._splat)) throw notFound();
  },
  head: ({ params }) => {
    const page = getDesignPage(params._splat);
    return docPageHead(page, page && designPublicUrl(page.url));
  },
  component: DesignPage,
});

function DesignPage() {
  const { _splat } = Route.useParams();
  const page = getDesignPage(_splat);
  if (!page) throw notFound();
  return (
    <DocFrame sections={designNav}>
      <DocPageView page={page} />
    </DocFrame>
  );
}
