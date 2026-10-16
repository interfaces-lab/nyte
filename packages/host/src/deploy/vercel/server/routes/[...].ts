import { defineHandler } from "nitro/h3";
import type { H3Event } from "nitro/h3";
import { vercelHost } from "../utils/host.ts";

async function serve(event: H3Event): Promise<Response> {
  return (await vercelHost()).listener.fetch(event.req);
}

export default defineHandler(serve);
