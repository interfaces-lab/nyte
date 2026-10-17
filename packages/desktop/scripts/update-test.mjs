import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The update test requires an Apple Silicon Mac.");
}

const desktop = fileURLToPath(new URL("../", import.meta.url));

const directory = await mkdtemp(join(tmpdir(), "nyte-update-test-"));

const feed = join(directory, "feed");

await mkdir(feed);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktop,
    env: { ...process.env, NYTE_UPDATE_TEST: "1" },
    stdio: "inherit",
  });

  if (result.error) throw result.error;

  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

run("pnpm", ["build"]);

for (const version of ["1.0.0", "1.0.1"]) {
  run("node", [
    "node_modules/electron-builder/out/cli/cli.js",
    "--config",
    "electron-builder.config.ts",
    "--mac",
    "zip",
    "--arm64",
    "--publish",
    "never",
    `--config.directories.output=${join(directory, version)}`,
    `--config.extraMetadata.version=${version}`,
  ]);
}

const files = new Map([
  ["/latest-mac.yml", "application/yaml"],
  ["/Nyte-1.0.1-mac-arm64.zip", "application/zip"],
]);

for (const name of files.keys()) await copyFile(join(directory, "1.0.1", name), join(feed, name));

const server = createServer(async (request, response) => {
  const name = new URL(request.url ?? "/", "http://localhost").pathname;
  const type = files.get(name);

  if (type === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end();

    return;
  }

  const path = join(feed, name);
  const { size } = await stat(path);
  response.writeHead(200, { "Content-Type": type, "Content-Length": size });
  console.log(`${request.method} ${name}`);

  if (request.method === "HEAD") response.end();
  else await pipeline(createReadStream(path), response).catch(() => response.destroy());
});

server.listen(8917, "127.0.0.1", () => {
  const app = join(directory, "1.0.0", "mac-arm64", "Nyte Update Test.app");
  console.log(`\nServing Nyte 1.0.1 at http://localhost:8917. Ctrl+C stops the feed.`);
  console.log(`Open 1.0.0:\nopen ${JSON.stringify(app)}`);
  console.log("Choose Nyte Update Test › Check for Updates…, then Restart to Update.");
  console.log("Logs: ~/Library/Application Support/Nyte Update Test/updates.log");
  console.log(`Remove ${directory} when done.`);
});
