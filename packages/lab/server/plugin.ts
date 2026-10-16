import { join } from "node:path";
import { ALL_AUTHORITY, LOCAL, type Listener } from "@nyte-ai/core";
import type { Plugin } from "vite";
import { canvasRoutes } from "./canvas-routes.ts";
import { openRepo } from "./git.ts";
import { CACHE_DIR, openReviewHost, type ReviewHost } from "./host.ts";
import { openRegistry } from "./registry.ts";
import { createReviews } from "./review.ts";
import { labPlugins } from "./reviewer.ts";
import { requestListener } from "./http.ts";

interface Opened {
  readonly host: ReviewHost;
  readonly server: Listener;
  readonly review: (request: Request) => Promise<Response>;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function open(log: (message: string) => void): Promise<Opened> {
  const repo = await openRepo();
  const registry = openRegistry(join(CACHE_DIR, "reviews.json"));

  const host = await openReviewHost({
    plugins: labPlugins({ repo, registry }),
  });

  log(
    `core is open on ${repo.root}; new briefs use ${host.config.model?.id ?? "the default model"}`,
  );

  let listener: Listener | undefined;

  try {
    listener = await host.sdk.listen({
      transport: { kind: "fetch" },
      auth: {
        kind: "custom",
        authorize: () => ({ principal: LOCAL, authority: ALL_AUTHORITY }),
      },
    });

    return {
      host,
      server: listener,
      review: await createReviews({ host, repo, registry, log }),
    };
  } catch (cause) {
    try {
      await listener?.close();
    } finally {
      await host.close();
    }

    throw cause;
  }
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
          log(`core did not open: ${describeError(cause)}`);
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
              return Response.json({ error: describeError(cause) }, { status: 503 });
            }
          },
          { onError: (cause) => log(describeError(cause)) },
        );

      server.middlewares.use(
        "/core/canvas",
        requestListener(canvasRoutes(core), { onError: (cause) => log(describeError(cause)) }),
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
        void opened
          ?.then(async (live) => {
            try {
              await live.server.close();
            } finally {
              await live.host.close();
            }
          })
          .catch((cause: unknown) => log(`core did not close: ${describeError(cause)}`));
      });
    },
  };
}
