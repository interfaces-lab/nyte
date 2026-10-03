import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { arch, platform, release } from "node:os";
import { pipeline } from "node:stream/promises";

const token = (await readFile(new URL("../.nyte-token.local", import.meta.url), "utf8")).trim();
const digest = createHash("sha256").update(token).digest();
const skippedHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "x-nyte-token",
]);

async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const presented = request.headers["x-nyte-token"];
  if (
    typeof presented !== "string" ||
    !timingSafeEqual(createHash("sha256").update(presented).digest(), digest)
  ) {
    response.writeHead(401).end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/backend-api/codex/responses") {
    response.writeHead(404).end();
    return;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value: unknown = chunk;
    if (!(value instanceof Uint8Array)) throw new Error("Invalid request body");
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(value);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      typeof value === "string" &&
      !skippedHeaders.has(name) &&
      !name.startsWith("cf-") &&
      !name.startsWith("x-forwarded-")
    )
      headers.set(name, value);
  }
  headers.set("user-agent", `nyte (${platform()} ${release()}; ${arch()})`);
  headers.set("accept-encoding", "identity");
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  const upstream = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers,
    body: Buffer.concat(chunks),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
  });
  response.statusCode = upstream.status;
  for (const [name, value] of upstream.headers) {
    if (!skippedHeaders.has(name) && name !== "content-encoding") response.setHeader(name, value);
  }
  if (upstream.body === null) response.end();
  else await pipeline(upstream.body, response, { signal: controller.signal });
}

const transport = createServer((request, response) => {
  void forward(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
});
transport.listen(8788, "127.0.0.1");
await once(transport, "listening");
const wrangler = spawn("pnpm", ["exec", "wrangler", "dev", "--local", ...process.argv.slice(2)], {
  cwd: new URL("../", import.meta.url),
  stdio: "inherit",
});
process.once("SIGINT", () => wrangler.kill("SIGINT"));
process.once("SIGTERM", () => wrangler.kill("SIGTERM"));
try {
  const [code]: readonly unknown[] = await once(wrangler, "exit");
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  transport.closeAllConnections();
  await new Promise<void>((resolve) => transport.close(() => resolve()));
}
