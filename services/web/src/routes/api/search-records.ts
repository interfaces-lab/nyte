import { createFileRoute } from "@tanstack/react-router";
import type { DocumentRecord } from "fumadocs-core/search/algolia";
import { searchIndexes } from "~/lib/docs";

export const Route = createFileRoute("/api/search-records")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          searchIndexes().map((page): DocumentRecord => ({
            _id: page.id,
            title: page.title,
            description: page.description,
            url: page.url,
            structured: page.structuredData,
          })),
        ),
    },
  },
});
