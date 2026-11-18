import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocPageView, docPageHead } from "~/components/site/doc-page";
import { DocFrame } from "~/components/site/frame";
import { docsNav, getDoc } from "~/lib/docs";

export const Route = createFileRoute("/_site/docs/$")({
  beforeLoad: ({ params }) => {
    if (!getDoc(params._splat)) throw notFound();
  },
  head: ({ params }) => docPageHead(getDoc(params._splat)),
  component: DocsPage,
});

function DocsPage() {
  const { _splat } = Route.useParams();
  const page = getDoc(_splat);
  if (!page) throw notFound();
  return (
    <DocFrame sections={docsNav}>
      <DocPageView page={page} />
    </DocFrame>
  );
}
