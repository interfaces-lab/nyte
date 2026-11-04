/**
 * The platforms Nyte ships. A release builds each on its own Blacksmith runner; `pnpm package`
 * builds the one this machine runs. Windows ships no release until it is polished; installs of an
 * older Windows build keep running the version they have.
 *
 *   node scripts/release-targets.mjs host               the CLI target this machine builds
 *   node scripts/release-targets.mjs desktop            the electron-builder flags for this machine
 *   node scripts/release-targets.mjs matrix <platform>  the release matrices, for `all` or one platform
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

/** `cli` builds the `nyte` binary; `desktop` holds the electron-builder flags for the desktop app. */
const RELEASE_TARGETS = [
  {
    name: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    runner: "blacksmith-6vcpu-macos-15",
    cli: true,
    desktop: ["--mac", "--arm64"],
  },
  {
    name: "linux-x64",
    platform: "linux",
    arch: "x64",
    runner: "blacksmith-4vcpu-ubuntu-2404",
    cli: true,
    desktop: ["--linux"],
  },
  {
    name: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    runner: "blacksmith-4vcpu-ubuntu-2404-arm",
    cli: true,
    desktop: undefined,
  },
];

/**
 * The target this process builds. Fails on a platform Nyte doesn't ship, such as an Intel Mac. Under
 * Rosetta, `process.arch` reports x64 on Apple silicon and Bun would compile x64 code, so a
 * translated process fails too.
 */
function hostTarget() {
  if (process.platform === "darwin" && translatedByRosetta()) {
    throw new Error(
      "This shell runs under Rosetta. Nyte ships Apple silicon builds only; package from a native arm64 terminal.",
    );
  }

  const target = RELEASE_TARGETS.find(
    (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
  );

  if (target === undefined) {
    throw new Error(`Nyte has no release target for ${process.platform}-${process.arch}.`);
  }

  return target;
}

function translatedByRosetta() {
  const result = spawnSync("sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8" });

  return result.stdout?.trim() === "1";
}

function releaseMatrices(platform) {
  const targets = RELEASE_TARGETS.filter(
    (target) => platform === "all" || target.platform === platform,
  );

  if (targets.length === 0) throw new Error(`No release target runs on ${platform}.`);

  return {
    cli: targets.flatMap((target) =>
      target.cli ? [{ runner: target.runner, target: target.name }] : [],
    ),
    desktop: targets.flatMap((target) =>
      target.desktop === undefined ? [] : [{ runner: target.runner, target: target.name }],
    ),
  };
}

function run(command) {
  if (command === "host") {
    const target = hostTarget();

    if (!target.cli) throw new Error(`Nyte ships no nyte binary for ${target.name}.`);

    return target.name;
  }

  if (command === "desktop") {
    const target = hostTarget();

    if (target.desktop === undefined) {
      throw new Error(
        `Nyte ships no desktop app for ${target.name}. Pass a platform flag, such as --linux.`,
      );
    }

    return target.desktop.join(" ");
  }

  if (command === "matrix") {
    const matrices = releaseMatrices(process.argv[3] ?? "all");

    return `cli=${JSON.stringify(matrices.cli)}\ndesktop=${JSON.stringify(matrices.desktop)}`;
  }

  throw new Error("Usage: release-targets.mjs host | desktop | matrix <all|darwin|linux>");
}

if (import.meta.main) {
  try {
    process.stdout.write(`${run(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
