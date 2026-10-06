import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const directory = join(root, "dist", "sdk");

const release = JSON.parse(readFileSync(join(directory, "release.json"), "utf8"));

if (process.env.RELEASE_TAG !== `v${release.version}`) {
  throw new Error(`Publishing requires RELEASE_TAG=v${release.version}`);
}

const tag = release.version.includes("-") ? "next" : "latest";

for (const entry of release.packages) {
  const lookup = spawnSync(
    "npm",
    ["view", `${entry.name}@${release.version}`, "version", "--json"],
    {
      encoding: "utf8",
    },
  );

  if (lookup.error) throw lookup.error;

  if (lookup.status === 0) {
    console.log(`Already published ${entry.name}@${release.version}`);
    continue;
  }

  const failure = JSON.parse(lookup.stdout);

  if (failure.error?.code !== "E404") {
    throw new Error(`Could not check ${entry.name}: ${lookup.stderr}`);
  }

  execFileSync(
    "npm",
    ["publish", join(directory, entry.file), "--access", "public", "--provenance", "--tag", tag],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}
