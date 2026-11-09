import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Installing a local build requires an Apple Silicon Mac.");
}

const desktop = fileURLToPath(new URL("../", import.meta.url));

const root = join(desktop, "..", "..");

const application = "/Applications/Nyte.app";

const BUILD_ATTEMPTS = 3;

const support = join(homedir(), "Library", "Application Support", "Nyte");

const updateLog = join(support, "updates.log");

if (!existsSync(application)) {
  throw new Error(`Install Nyte in ${application} first. This script updates it in place.`);
}

const installed = bundleVersion();

const channel = existsSync(join(support, "updates.json"))
  ? JSON.parse(readFileSync(join(support, "updates.json"), "utf8")).channel
  : installed.includes("-nightly.")
    ? "nightly"
    : "stable";

if (channel !== "nightly") {
  throw new Error(
    "Nyte installs a ready update on quit only on the nightly channel. Turn it on in Settings > Developer > Update channel, then run this again.",
  );
}

const version = nightlyVersion();

console.log(`Building Nyte ${version} to replace ${installed}.`);

packageBuild();

const zip = `Nyte-${version}-mac-arm64.zip`;

const files = new Map([
  ["/latest-mac.yml", ["nightly-mac.yml", "application/yaml"]],
  ["/nightly-mac.yml", ["nightly-mac.yml", "application/yaml"]],
  [`/${zip}`, [zip, "application/zip"]],
]);

const server = createServer(async (request, response) => {
  const file = files.get(new URL(request.url ?? "/", "http://127.0.0.1").pathname);

  if (file === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404).end();

    return;
  }

  const path = join(desktop, "dist", file[0]);
  const size = (await stat(path)).size;
  response.writeHead(200, { "Content-Type": file[1], "Content-Length": size });

  if (request.method === "HEAD") response.end();
  else await pipeline(createReadStream(path), response).catch(() => response.destroy());
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));

const port = server.address().port;

const feed = `http://127.0.0.1:${port}`;

try {
  await quit();
  const offset = logSize();
  console.log(`Serving ${version} on ${feed}. Reopening Nyte to fetch it.`);
  run("open", ["-a", application, "--env", `NYTE_UPDATE_FEED_PORT=${port}`]);
  await downloaded(offset);
  console.log("Downloaded. Quitting Nyte to install it.");
  await quit();
  await installedVersion();
  run("open", ["-a", application]);
  console.log(`Nyte ${version} is installed and open.`);
} finally {
  server.close();
}

/** The next patch after the latest stable tag, as nightlies are, with the time as the run so it sorts above the installed build. */
function nightlyVersion() {
  const time = new Date().toISOString().slice(11, 19).replaceAll(":", "");
  const run = String(Math.max(1, Number(time)));

  const output = execFileSync("node", ["scripts/release-version.mjs", "resolve", "--nightly"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_RUN_NUMBER: run },
  });

  return output.trim().replace(/^version=/u, "");
}

/** Empty while ShipIt has the bundle half swapped. */
function bundleVersion() {
  return spawnSync(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", join(application, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).stdout.trim();
}

function running() {
  return spawnSync("pgrep", ["-f", `${application}/Contents/MacOS/Nyte`]).status === 0;
}

async function quit() {
  if (!running()) return;
  run("osascript", ["-e", 'tell application id "ai.nyte.desktop" to quit']);
  await until("Nyte to quit", 120_000, () => !running());
}

function logSize() {
  return existsSync(updateLog) ? readFileSync(updateLog).length : 0;
}

/** Waits for the app's own update log to report this build downloaded, so the swap goes through its updater. */
async function downloaded(offset) {
  await until(`Nyte to download ${version}`, 300_000, () => {
    const lines = existsSync(updateLog)
      ? readFileSync(updateLog).subarray(offset).toString("utf8").split("\n")
      : [];

    const events = lines.filter((line) => line !== "").map((line) => JSON.parse(line));
    const started = events.find((event) => event.event === "app-started");

    if (started !== undefined && started.feed !== feed) {
      throw new Error(
        `Nyte ${installed} predates NYTE_UPDATE_FEED_PORT. Quit it and replace ${application} with ${join(desktop, "dist", "mac-arm64", "Nyte.app")} once, then run this again.`,
      );
    }

    const failed = events.find((event) => event.event === "error");

    if (failed !== undefined) throw new Error(`The update failed: ${failed.message}`);

    if (events.some((event) => event.event === "update-not-available")) {
      throw new Error(`Nyte ${installed} didn't take ${version}. Is the installed build newer?`);
    }

    return events.some(
      (event) => event.event === "update-downloaded" && event.targetVersion === version,
    );
  });
}

async function installedVersion() {
  await until(`${application} to become ${version}`, 180_000, () => bundleVersion() === version);
}

async function until(label, timeout, done) {
  const deadline = Date.now() + timeout;

  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await sleep(1_000);
  }
}

/** Apple's timestamp server drops the odd one of the hundreds of signing requests a build makes, so a failed build runs again, three times in all. */
function packageBuild() {
  for (let attempt = 1; ; attempt += 1) {
    const status = spawnSync(
      "node",
      ["scripts/build.mjs", "--package", "--publish", "never", "--mac", "zip", "--arm64"],
      { cwd: desktop, env: { ...process.env, NYTE_RELEASE_VERSION: version }, stdio: "inherit" },
    ).status;

    if (status === 0) return;

    if (attempt === BUILD_ATTEMPTS) {
      throw new Error(`The build failed ${BUILD_ATTEMPTS} times. Nyte ${installed} is unchanged.`);
    }

    console.log(`The build failed (attempt ${attempt} of ${BUILD_ATTEMPTS}). Building again.`);
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: desktop,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  if (result.error) throw result.error;

  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}
