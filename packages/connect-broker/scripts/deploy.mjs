import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const broker = fileURLToPath(new URL("../", import.meta.url));

const DATABASE = "nyte-connect";

function run(command, args, output = "inherit") {
  return execFileSync(command, args, {
    cwd: broker,
    encoding: "utf8",
    stdio: ["ignore", output, "inherit"],
  });
}

function wrangler(args, output) {
  return run("pnpm", ["exec", "wrangler", ...args], output);
}

wrangler(["deploy", "--dry-run", "--outdir", "dist"], "ignore");

const migrations = readdirSync(`${broker}migrations`)
  .toSorted()
  .map((file) => `migrations/${file}`);

const digest = createHash("sha256");

for (const file of ["dist/index.js", "wrangler.jsonc", ...migrations])
  digest.update(readFileSync(`${broker}${file}`));

const tag = digest.digest("hex").slice(0, 32);

const live = JSON.parse(wrangler(["deployments", "status", "--json"], "pipe"));

const liveTags = live.versions.map(
  (version) =>
    JSON.parse(wrangler(["versions", "view", version.version_id, "--json"], "pipe")).annotations[
      "workers/tag"
    ],
);

if (liveTags.length === 1 && liveTags[0] === tag) {
  console.log(`The live broker already runs ${tag}.`);
  process.exit(0);
}

run("pnpm", ["typecheck"]);

run("pnpm", ["test"]);

wrangler(["d1", "migrations", "apply", DATABASE, "--remote"]);

wrangler(["deploy", "--tag", tag, "--message", process.env.GITHUB_SHA ?? "local"]);
