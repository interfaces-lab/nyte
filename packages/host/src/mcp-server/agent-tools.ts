import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { AcpClientServices } from "@nyte-ai/plugin/core/acp";

const relay = String.raw`
import { createInterface } from "node:readline";
const endpoint = process.env.NYTE_ACP_ENDPOINT;
const token = process.env.NYTE_ACP_GRANT;
const pending = new Set();
let writes = Promise.resolve();
function send(value) {
  writes = writes.then(() => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + "\n", error => error ? reject(error) : resolve())));
  return writes;
}
async function forward(line) {
  let message;
  try {
    if (Buffer.byteLength(line) > 1048576) throw new Error("MCP request too large");
    message = JSON.parse(line);
    const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: {
      authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json, text/event-stream"
    }, body: line });
    if (response.status === 202) return;
    if (!response.ok) throw new Error("MCP gateway rejected the request");
    const text = await response.text();
    if (Buffer.byteLength(text) > 4194304) throw new Error("MCP response too large");
    await send(JSON.parse(text));
  } catch {
    if (message && message.id !== undefined) await send({ jsonrpc: "2.0", id: message.id, error: { code: -32_603, message: "Nyte's scoped tool gateway is unavailable." } });
  }
}
createInterface({ input: process.stdin }).on("line", line => {
  const operation = forward(line).finally(() => pending.delete(operation)); pending.add(operation);
}).on("close", async () => { await Promise.allSettled(pending); await writes; });
`;

export const agentToolServices: AcpClientServices = {
  async gateway(scope) {
    const token = randomBytes(32).toString("base64url");
    const expected = Buffer.from(`Bearer ${token}`);
    const abort = new AbortController();

    const server = createServer((request, response) => void serve(request, response));

    async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const authorized = supplied.length === expected.length && timingSafeEqual(supplied, expected);

      if (
        abort.signal.aborted ||
        !authorized ||
        request.headers.origin !== undefined ||
        request.url !== "/tools" ||
        request.headers.host !== `127.0.0.1:${port}`
      ) {
        response.writeHead(403).end();

        return;
      }

      if (request.method === "DELETE") {
        response.writeHead(204).end();

        return;
      }

      if (request.method !== "POST") {
        response.writeHead(405).end();

        return;
      }

      try {
        const chunks: Buffer[] = [];
        let size = 0;

        for await (const chunk of request) {
          const bytes =
            typeof chunk === "string"
              ? Buffer.from(chunk)
              : Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.alloc(0);

          size += bytes.length;

          if (size > 1024 * 1024) {
            response.writeHead(413).end();

            return;
          }

          chunks.push(bytes);
        }

        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        if (
          !isJson(value) ||
          !isJsonObject(value) ||
          value.jsonrpc !== "2.0" ||
          typeof value.method !== "string"
        ) {
          response.writeHead(400).end();

          return;
        }

        if (!("id" in value)) {
          response.writeHead(202).end();

          return;
        }

        if (typeof value.id !== "string" && typeof value.id !== "number") {
          response.writeHead(400).end();

          return;
        }

        const answer = await dispatch(value.method, value.params, String(value.id));
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: value.id, ...answer }));
      } catch {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    }

    const close = async () => {
      if (abort.signal.aborted) return;
      abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    scope.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();

    if (address === null || typeof address === "string") {
      await close();
      throw new Error("The agent tool gateway has no loopback address.");
    }

    const port = address.port;

    if (scope.signal.aborted) {
      await close();
      throw new Error("The agent tool scope was revoked during setup.");
    }

    const url = `http://127.0.0.1:${port}/tools`;

    const operations = new Map<
      string,
      { readonly digest: string; readonly result: Promise<Json> }
    >();

    const dispatch = async (
      method: string,
      params: Json | undefined,
      request: string,
    ): Promise<
      | { readonly result: Json }
      | { readonly error: { readonly code: number; readonly message: string } }
    > => {
      if (method === "initialize") {
        return {
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "nyte", version: "1" },
          },
        };
      }
      if (method === "ping") return { result: {} };
      const tools = scope.tools();

      if (tools === undefined || scope.signal.aborted) {
        return {
          error: { code: -32_000, message: "No live provider run owns this tool request." },
        };
      }
      if (method === "tools/list") {
        return {
          result: {
            tools: (await tools.offered()).map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters,
            })),
          },
        };
      }
      if (method !== "tools/call") {
        return { error: { code: -32_601, message: "Only tools are available on this endpoint." } };
      }
      if (
        !isJsonObject(params) ||
        typeof params.name !== "string" ||
        (params.arguments !== undefined && !isJsonObject(params.arguments))
      ) {
        return { error: { code: -32_602, message: "Invalid tool arguments." } };
      }
      const args = params.arguments ?? {};
      const digest = JSON.stringify({ name: params.name, args });
      const previous = operations.get(request);

      if (previous !== undefined) {
        return previous.digest === digest
          ? { result: await previous.result }
          : {
              error: { code: -32_600, message: "This request id already names another operation." },
            };
      }
      if (operations.size >= 512) {
        return { error: { code: -32_000, message: "The agent tool request limit was reached." } };
      }
      const result = tools
        .invoke({
          operation: crypto.randomUUID(),
          name: params.name,
          args,
          signal: AbortSignal.any([scope.signal, abort.signal]),
        })
        .then((outcome): Json => {
          if (outcome.kind === "ok") {
            return {
              content: outcome.content.flatMap((content) =>
                content.kind === "text" ? [{ type: "text", text: content.text }] : [],
              ),
              isError: false,
            };
          }
          return {
            content: [
              {
                type: "text",
                text:
                  outcome.kind === "failed"
                    ? outcome.message
                    : outcome.kind === "rejected"
                      ? outcome.reason
                      : "The tool call was interrupted.",
              },
            ],
            isError: true,
          };
        });

      operations.set(request, { digest, result });

      return { result: await result };
    };

    return {
      servers(peer, transport) {
        const http = peer.agentCapabilities?.mcpCapabilities?.http === true;

        if (transport !== "stdio-only" && http) {
          return [
            {
              type: "http",
              name: "nyte",
              url,
              headers: [{ name: "Authorization", value: `Bearer ${token}` }],
            },
          ];
        }
        if (transport === "http-only") return [];

        return [
          {
            name: "nyte",
            command: process.execPath,
            args: ["--input-type=module", "--eval", relay],
            env: [
              { name: "NYTE_ACP_ENDPOINT", value: url },
              { name: "NYTE_ACP_GRANT", value: token },
              { name: "ELECTRON_RUN_AS_NODE", value: "1" },
            ],
          },
        ];
      },
      close,
    };
  },
};
