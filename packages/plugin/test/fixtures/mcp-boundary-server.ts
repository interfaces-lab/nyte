import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";
import { Value } from "typebox/value";

const Options = Type.Object({
  tools: Type.Array(Type.Unknown()),
  result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  nextTools: Type.Optional(Type.Array(Type.Unknown())),
  paginated: Type.Optional(Type.Boolean()),
  waitForCancellation: Type.Optional(Type.Boolean()),
});
const options: unknown = JSON.parse(process.argv[2] ?? "{}");
if (!Value.Check(Options, options)) throw new Error("Invalid fixture options");

const server = new Server(
  { name: "boundary", version: "0" },
  { capabilities: { tools: { listChanged: true } } },
);
let tools = options.tools;
server.setRequestHandler(ListToolsRequestSchema, (request) => {
  if (!options.paginated) return { tools };
  return request.params?.cursor === undefined
    ? { tools: tools.slice(0, 1), nextCursor: "second" }
    : { tools: tools.slice(1) };
});
server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
  const { _meta: meta } = request.params;
  const progressToken = meta?.progressToken;
  if (progressToken !== undefined) {
    await server.notification({
      method: "notifications/progress",
      params: { progressToken, progress: 1, total: 2, message: "Working" },
    });
  }
  if (options.waitForCancellation) {
    await new Promise<void>((resolve) => {
      if (context.signal.aborted) resolve();
      else context.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    tools = [{ name: "cancelled", inputSchema: { type: "object" } }];
    await server.notification({ method: "notifications/tools/list_changed" });
  } else if (options.nextTools !== undefined) {
    tools = options.nextTools;
    await server.notification({ method: "notifications/tools/list_changed" });
  }
  return { content: [{ type: "text", text: request.params.name }] };
});
const transport = new StdioServerTransport();
await server.connect(transport);
const dispatch = transport.onmessage;
// Inject call results at the wire boundary so the SDK does not validate them for the client.
// oxlint-disable-next-line unicorn/prefer-add-event-listener
transport.onmessage = (message) => {
  if (
    "id" in message &&
    "method" in message &&
    message.method === "tools/call" &&
    options.result !== undefined
  ) {
    void transport.send({ jsonrpc: "2.0", id: message.id, result: options.result });
    return;
  }
  dispatch?.(message);
};
