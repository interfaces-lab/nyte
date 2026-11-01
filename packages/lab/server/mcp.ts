import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpClient, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { LAB_HOME } from "./core.ts";

const CONFIG = join(LAB_HOME, ".nyte", "mcp.json");

const HttpServer = Type.Object({
  url: Type.String(),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const Config = Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) });

const Args = Type.Record(Type.String(), Type.Unknown());

/**
 * Calls the lab home's HTTP MCP servers straight from a page, outside any session: `GET /core/mcp`
 * lists the servers, `GET /core/mcp/<server>` its tools, `POST /core/mcp/<server>/<tool>` calls one
 * with the JSON body as arguments. Sessions get the same servers through core's own hub.
 */
export async function serveMcp(request: Request, path: string): Promise<Response> {
  const servers = await readServers();
  const [name, tool] = path.split("/").filter((part) => part !== "");

  if (name === undefined) return Response.json([...servers.keys()]);

  const server = servers.get(name);

  if (server === undefined)
    return new Response(`No HTTP server named ${name} in ${CONFIG}.`, { status: 404 });

  const client = new McpClient({ name: "nyte-lab", version: "0.0.0" });

  await client.connect(
    new StreamableHttpTransport({ url: server.url, headers: server.headers, openGetStream: false }),
  );

  try {
    if (tool === undefined) return Response.json(await client.listTools());

    const args: unknown = request.method === "POST" ? await request.json() : {};

    if (!Value.Check(Args, args))
      return new Response("The body must be a JSON object of arguments.", { status: 400 });

    return Response.json(await client.callTool(tool, args));
  } finally {
    await client.close();
  }
}

async function readServers(): Promise<ReadonlyMap<string, Static<typeof HttpServer>>> {
  const text = await readFile(CONFIG, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });

  const config: unknown = JSON.parse(text);

  if (!Value.Check(Config, config)) return new Map();

  return new Map(
    Object.entries(config.mcpServers).flatMap(([name, entry]) =>
      Value.Check(HttpServer, entry) ? [[name, entry] as const] : [],
    ),
  );
}
