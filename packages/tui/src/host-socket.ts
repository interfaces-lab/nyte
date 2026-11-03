import { existsSync } from "node:fs";
import process from "node:process";
import { openHostSocket } from "@nyte-ai/protocol";
import type { HostSocket } from "@nyte-ai/protocol";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import { VERSION } from "./version.ts";

export async function connectHostSocket(input: {
  readonly hostUrl: string | undefined;
  readonly name: string;
}): Promise<HostSocket> {
  const endpoint = await findEndpoint(input.hostUrl);

  return openHostSocket({
    socket: new WebSocket(endpoint.url, {
      headers: endpoint.token === undefined ? {} : { Authorization: `Bearer ${endpoint.token}` },
    }),
    client: { kind: "cli", name: input.name, version: VERSION, actions: [] },
  });
}

async function findEndpoint(
  hostUrl: string | undefined,
): Promise<{ readonly url: string; readonly token: string | undefined }> {
  if (hostUrl !== undefined) {
    const token = process.env["NYTE_HOST_TOKEN"];
    delete process.env["NYTE_HOST_TOKEN"];

    return { url: socketUrl(hostUrl), token };
  }

  const running = await findRunningHost(hostFilePath());

  if (running === null)
    throw new Error(
      "No Nyte host is running. Start one with `nyte host`, or pass --host-url <url> with NYTE_HOST_TOKEN set.",
    );

  if (running.socket !== undefined && existsSync(running.socket))
    return { url: `ws+unix://${running.socket}:/.nyte/ws`, token: running.token };

  return { url: socketUrl(running.url), token: running.token };
}

function socketUrl(hostUrl: string): string {
  const url = new URL("/.nyte/ws", hostUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return url.href;
}
