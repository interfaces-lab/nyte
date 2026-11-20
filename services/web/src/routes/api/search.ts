import { createFileRoute } from "@tanstack/react-router";
import { createSearchAPI } from "fumadocs-core/search/server";
import { searchIndexes } from "~/lib/docs";

const search = createSearchAPI("advanced", { indexes: searchIndexes });

export const Route = createFileRoute("/api/search")({
  server: { handlers: { GET: ({ request }) => search.GET(request) } },
});
