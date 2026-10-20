import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import process from "node:process";

export const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));

const readTrace = (traceparent) => {
  const id = typeof traceparent === "string" ? traceparent.split("-")[1] : undefined;

  if (id === undefined || !/^[0-9a-f]{32}$/.test(id)) return null;

  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
};

export function serve(server, handlers) {
  const lines = createInterface({ input: process.stdin });

  lines.on("close", () => process.exit(0));
  lines.on("line", async (line) => {
    const message = JSON.parse(line);

    if (message.id === undefined) return;
    const handler = handlers[message.method];

    if (handler === undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });

      return;
    }

    const start = performance.timeOrigin + performance.now();
    const result = await handler(message.params);

    if (message.method === "tools/call" && process.env.NYTE_TRACE_FILE !== undefined)
      appendFileSync(
        process.env.NYTE_TRACE_FILE,
        `${JSON.stringify({
          name: "mcp.serve",
          trace: readTrace(message.params?._meta?.traceparent),
          start,
          duration: performance.timeOrigin + performance.now() - start,
          detail: { server, tool: message.params?.name ?? null, pid: process.pid },
        })}\n`,
      );

    send({ jsonrpc: "2.0", id: message.id, result });
  });
}
