import { createFileRoute } from "@tanstack/react-router";
import { everyPage } from "~/lib/docs";

let full: Promise<string> | undefined;

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        full ??= Promise.all(everyPage().map((page) => page.text())).then((pages) =>
          pages.join("\n\n"),
        );
        return new Response(await full);
      },
    },
  },
});
