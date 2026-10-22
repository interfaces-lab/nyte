import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const [command, version, option, ...extra] = process.argv.slice(2);

function nextPatch(version) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(
    version.replace(/[-+].*$/u, ""),
  );

  if (stable === null) throw new Error(`Invalid source version: ${version}`);

  return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}`;
}

if (command === "resolve" && version === undefined) {
  const run = process.env["GITHUB_RUN_NUMBER"];

  if (run === undefined || !/^[1-9]\d*$/u.test(run))
    throw new Error("Set GITHUB_RUN_NUMBER to the nightly workflow run number.");
  const desktop = JSON.parse(readFileSync(join(root, "packages/desktop/package.json"), "utf8"));
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  process.stdout.write(`version=${nextPatch(desktop.version)}-nightly.${date}.${run}\n`);
} else if (
  command === "prepare" &&
  version !== undefined &&
  (option === undefined || option === "--check") &&
  extra.length === 0
) {
  const nightly = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.\d{8}\.[1-9]\d*$/u;

  if (!nightly.test(version)) throw new Error(`Invalid nightly version: ${version}`);
  const [group] = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8")).fixed;

  const manifests = globSync(["packages/*/package.json", "packages/examples/*/package.json"], { cwd: root }).map((file) => ({
    file: join(root, file),
    manifest: JSON.parse(readFileSync(join(root, file), "utf8")),
  }));

  const released = group.map((name) => {
    const entry = manifests.find(({ manifest }) => manifest.name === name);

    if (entry === undefined) throw new Error(`Missing release package: ${name}`);

    return entry;
  });

  const source = released.find(({ manifest }) => manifest.version !== version)?.manifest.version;

  if (source !== undefined) {
    if (
      released.some(({ manifest }) => manifest.version !== source && manifest.version !== version)
    )
      throw new Error("The Changesets fixed group must share one source version.");

    if (!version.startsWith(`${nextPatch(source)}-nightly.`))
      throw new Error(`Nightly must preview ${nextPatch(source)} from source version ${source}.`);
  }

  if (option !== "--check") {
    for (const { file, manifest } of released) {
      if (manifest.version !== version)
        writeFileSync(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
    }
  }
} else {
  throw new Error(
    "Usage: node scripts/nightly-release.mjs <resolve | prepare <version> [--check]>",
  );
}
