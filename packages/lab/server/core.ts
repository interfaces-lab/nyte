import { join } from "node:path";
import { ALL_AUTHORITY, LOCAL, type Listener } from "@nyte-ai/core";
import { openRepo } from "./git.ts";
import { CACHE_DIR, openReviewHost, type ReviewHost } from "./host.ts";
import { Registry } from "./registry.ts";
import { createReviews } from "./review.ts";
import { labPlugins } from "./reviewer.ts";
import { studioRoutes } from "./studio-routes.ts";

export interface Opened {
  readonly host: ReviewHost;
  readonly server: Listener;
  readonly review: (request: Request) => Promise<Response>;
}

declare global {
  /** One core per dev server: Start re-runs server modules on every edit. */
  var nyteLabCore: Promise<Opened> | undefined;
}

export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const log = (message: string): void => console.info(`[lab core] ${message}`);

async function open(): Promise<Opened> {
  const repo = await openRepo();
  const registry = new Registry(join(CACHE_DIR, "reviews.json"));

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

export function core(): Promise<Opened> {
  globalThis.nyteLabCore ??= open().catch((cause: unknown) => {
    globalThis.nyteLabCore = undefined;
    log(`core did not open: ${describeError(cause)}`);
    throw cause;
  });

  return globalThis.nyteLabCore;
}

/** The request as its handler sees it: the path below the route's mount point. */
function below(mount: string, request: Request): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(mount.length) || "/";

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: request.body, duplex: "half" as const };

  return new Request(url.href, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    ...body,
  });
}

function mounted(
  mount: string,
  handle: (request: Request) => Promise<Response>,
): (context: { readonly request: Request }) => Promise<Response> {
  return async ({ request }) => {
    try {
      return await handle(below(mount, request));
    } catch (cause) {
      log(describeError(cause));

      return Response.json({ error: describeError(cause) }, { status: 503 });
    }
  };
}

export const nyteHandler = mounted("/core/nyte", async (request) =>
  (await core()).server.fetch(request),
);

export const reviewHandler = mounted("/core/review", async (request) =>
  (await core()).review(request),
);

export const studioHandler = mounted("/core/studio", studioRoutes(core));
