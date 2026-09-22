import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";

const directory = process.argv[2];

if (!directory || process.argv.length !== 3) {
  throw new Error("Usage: node serve.mjs <generated-feed-directory>");
}

const feed = resolve(directory);

const files = new Map([
  ["/appcast.xml", { name: "appcast.xml", type: "application/xml" }],
  ["/Nyte-Update-Test-1.0.1.zip", { name: "Nyte-Update-Test-1.0.1.zip", type: "application/zip" }],
]);

for (const file of files.values()) await stat(join(feed, file.name));

const server = createServer(async (request, response) => {
  const file = files.get(request.url ?? "");

  if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end();

    return;
  }

  try {
    const path = join(feed, file.name);
    const { size } = await stat(path);
    response.writeHead(200, {
      "Content-Type": file.type,
      "Content-Length": size,
      "Cache-Control": "no-store",
    });
    console.log(`${request.method} ${request.url}`);

    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(path), response);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    if (!response.headersSent) response.writeHead(500).end();
    else response.destroy();
  }
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

server.listen(8917, "127.0.0.1", () => {
  console.log(`Serving ${feed} at http://localhost:8917. Ctrl+C stops the feed.`);
});
