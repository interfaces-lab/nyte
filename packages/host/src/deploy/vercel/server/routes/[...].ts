import { defineHandler } from "nitro/h3";
import type { H3Event } from "nitro/h3";
import { vercelHost } from "../utils/host.ts";

async function serve(event: H3Event): Promise<Response> {
  return (await vercelHost()).listener.fetch(event.req);
}

/** Answers every path (Nitro's catch-all route) through this instance's listener, `(await vercelHost()).listener.fetch(event.req)`: `defineHandler` and `H3Event` come through Nitro's own `nitro/h3` re-export of the h3 it bundles, so the template depends on `nitro` alone (§43i); in h3 2 the event's `req` is already the Web `Request` (h3 1's `toWebRequest(event)` is gone), its body streamed and its signal aborted when the client goes away. */
export default defineHandler(serve);
