import { createFileRoute } from "@tanstack/react-router";
import { SignedIn } from "~/components/site/signed-in";
import { pageHead } from "~/lib/seo";

export const Route = createFileRoute("/_site/desktop/signed-in")({
  head: () =>
    pageHead({
      title: "Signed in",
      description: "Return to Nyte to finish signing in.",
      noindex: true,
    }),
  component: SignedInPage,
});

function SignedInPage() {
  return (
    <main className="mx-auto flex w-[min(100%,var(--site-inner))] flex-1 flex-col justify-center px-(--site-pad) py-16">
      <SignedIn />
    </main>
  );
}
