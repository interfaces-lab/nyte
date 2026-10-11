import process from "node:process";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { wakeSession } from "./dispatch.ts";
import { reconcileSessionDispatch } from "./reconcile.ts";
import { openRuntime } from "./runtime.ts";

let runtime: ReturnType<typeof openRuntime> | undefined;

async function reconcile(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const secret = process.env.CRON_SECRET;

  if (!secret) return new Response(null, { status: 401 });
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return new Response(null, { status: 401 });

  return Response.json(await reconcileSessionDispatch());
}

function logReconcileFailure(cause: unknown): void {
  console.error(
    JSON.stringify({
      event: "nyte.reconcile.failure",
      name: cause instanceof Error ? cause.name : "unknown",
    }),
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/v1/reconcile") return reconcile(request);

    if (runtime === undefined) {
      const opening = openRuntime(wakeSession).catch((cause: unknown) => {
        runtime = undefined;
        throw cause;
      });

      runtime = opening;
      // Cold-start repair supplements the cron; it waits so schema setup is not raced.
      waitUntil(opening.then(() => reconcileSessionDispatch()).catch(logReconcileFailure));
    }

    return (await runtime).fetch(request);
  },
};
