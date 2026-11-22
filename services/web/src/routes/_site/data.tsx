import { createFileRoute } from "@tanstack/react-router";
import { UsageData } from "~/components/usage-data/usage-data";
import { pageHead } from "~/lib/seo";
import { loadUsageStats } from "~/lib/usage-stats";

export const Route = createFileRoute("/_site/data")({
  loader: () => loadUsageStats(),
  staleTime: 10 * 60 * 1000,
  head: () =>
    pageHead({
      title: "Nyte by the numbers",
      description: "Anonymous, aggregate counts of Nyte installs, versions, platforms and usage.",
      canonical: "https://nyte.sh/data",
    }),
  component: DataPage,
});

function DataPage() {
  return <UsageData stats={Route.useLoaderData()} />;
}
