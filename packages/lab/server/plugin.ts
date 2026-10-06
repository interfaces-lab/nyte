/**
 * Serves real core from the lab's dev server. `/core/nyte` is the Nyte wire
 * (`@nyte-ai/server`: JSON calls and SSE watches) that `@nyte-ai/client`
 * speaks; `/core/review` is the Review page's API in `review.ts`. Core opens
 * on the first request, so the lab still starts without a signed-in model,
 * and the static build has neither route.
 */
import { join } from "node:path";
import { createNyteServer, type NyteServer } from "@nyte-ai/server";
import { requestListener } from "@nyte-ai/server/node";
import type { Plugin } from "vite";
import { canvasRoutes } from "./canvas-routes.ts";
import { openRepo } from "./git.ts";
import { CACHE_DIR, openReviewHost, type ReviewHost } from "./host.ts";
import { openRegistry } from "./registry.ts";
import { createReviews } from "./review.ts";
import { labPlugins } from "./reviewer.ts";

interface Opened {
  readonly host: ReviewHost;
  readonly server: NyteServer;
  readonly review: (request: Request) => Promise<Response>;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function open(log: (message: string) => void): Promise<Opened> {
  const repo = await openRepo();
  const registry = openRegistry(join(CACHE_DIR, "reviews.json"));

  const host = await openReviewHost({
    plugins: labPlugins({ repo, registry }),
    onDiagnostic: log,
  });

  log(
    `core is open on ${repo.root}; new briefs use ${host.config.model?.id ?? "the default model"}`,
  );

  return {
    host,
    server: createNyteServer({
      sdk: host.sdk,
      version: "lab",
      // The dev server already decides who reaches it.
      auth: { kind: "custom", authorize: () => ({ kind: "allow" }) },
      onError: (failure) => log(`${failure.route} failed: ${messageOf(failure.cause)}`),
    }),
    review: await createReviews({ host, repo, registry, log }),
  };
}

export function reviewCore(): Plugin {
  return {
    name: "nyte-lab-review-core",
    apply: "serve",
    configureServer(server) {
      const log = (message: string): void =>
        server.config.logger.info(`[review core] ${message}`, { timestamp: true });

      let opened: Promise<Opened> | undefined;

      const core = (): Promise<Opened> => {
        opened ??= open(log).catch((cause: unknown) => {
          opened = undefined;
          log(`core did not open: ${messageOf(cause)}`);
          throw cause;
        });

        return opened;
      };

      const listen = (handle: (core: Opened, request: Request) => Promise<Response>) =>
        requestListener(
          async (request) => {
            try {
              return await handle(await core(), request);
            } catch (cause) {
              return Response.json({ error: messageOf(cause) }, { status: 503 });
            }
          },
          { onError: (cause) => log(messageOf(cause)) },
        );

      server.middlewares.use(
        "/core/canvas",
        requestListener(canvasRoutes(core), { onError: (cause) => log(messageOf(cause)) }),
      );
      server.middlewares.use(
        "/core/nyte",
        listen((opened, request) => opened.server.fetch(request)),
      );
      server.middlewares.use(
        "/core/review",
        listen((opened, request) => opened.review(request)),
      );

      server.httpServer?.once("close", () => {
        void opened?.then(async (live) => {
          live.server.close();
          await live.host.close();
        });
      });
    },
  };
}
