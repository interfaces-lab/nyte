import { defineHandler } from "h3";
import type { H3Event } from "h3";

async function serve(event: H3Event): Promise<Response> {
  throw new Error("not implemented");
}

/** Answers every path (Nitro's catch-all route) through this instance's listener, `(await vercelHost()).listener.fetch(event.req)`: in h3 2 the event's `req` is already the Web `Request` (h3 1's `toWebRequest(event)` is gone), its body streamed and its signal aborted when the client goes away. */
export default defineHandler(serve);
