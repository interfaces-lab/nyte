/**
 * Bundles the TUI for every release target from one machine.
 *
 * `compile` statically defines `process.platform`, so a bundle only resolves the
 * native modules its own target reaches. Building the host target alone
 * therefore says nothing about the others: a missing Linux native module stayed
 * invisible on macOS until the Linux runner tried to compile it. Bundling each
 * target here, with the same defines the real build uses, surfaces that without
 * a push. Resolution is the whole point, so this skips `compile` and never
 * downloads a target runtime.
 *
 * A target whose native module this machine has no reason to install is
 * reported as skipped rather than failed. On a Linux runner both libc variants
 * are installed, so the case that actually broke the release is covered.
 */
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";

const packages = fileURLToPath(new URL("../../", import.meta.url));

const targets = [
  { platform: "darwin", arch: "arm64", libc: undefined },
  { platform: "darwin", arch: "x64", libc: undefined },
  { platform: "linux", arch: "x64", libc: "glibc" },
  { platform: "linux", arch: "arm64", libc: "glibc" },
  { platform: "linux", arch: "x64", libc: "musl" },
  { platform: "linux", arch: "arm64", libc: "musl" },
];

function describe(cause: unknown): string {
  if (cause instanceof AggregateError) {
    return cause.errors.map((error: unknown) => describe(error)).join("; ");
  }
  return cause instanceof Error ? cause.message : String(cause);
}

let failed = 0;
let skipped = 0;
for (const target of targets) {
  const suffix = target.libc === "musl" ? "-musl" : "";
  const native = `@opentui/core-${target.platform}-${target.arch}${suffix}`;
  const label = `${target.platform}-${target.arch}${target.libc === undefined ? "" : `-${target.libc}`}`;

  const outcome = await Bun.build({
    entrypoints: [
      join(packages, "tui/src/binary.ts"),
      join(packages, "core/src/kernel/store-worker.ts"),
    ],
    root: packages,
    target: "bun",
    plugins: [solidPlugin],
    define: {
      "process.platform": JSON.stringify(target.platform),
      "process.arch": JSON.stringify(target.arch),
      "process.env.OPENTUI_LIBC": JSON.stringify(target.libc ?? "glibc"),
    },
  }).then(
    (result) => (result.success ? undefined : result.logs.map((log) => log.message).join("; ")),
    (cause: unknown) => describe(cause),
  );

  if (outcome === undefined) {
    process.stdout.write(`✓ ${label}\n`);
    continue;
  }

  // pnpm installs native modules only for architectures this machine can use, so
  // a bundle that fails solely on its own target's native module proves nothing
  // about the source. Anything else is a real break.
  const unrelated = outcome.split("; ").filter((message) => !message.includes("@opentui/core-"));
  if (unrelated.length === 0) {
    process.stdout.write(`- ${label} (skipped: ${native} is not installed here)\n`);
    skipped += 1;
    continue;
  }
  process.stdout.write(`✗ ${label}: ${unrelated.join("; ")}\n`);
  failed += 1;
}

process.stdout.write(
  `\n${targets.length - failed - skipped} bundled, ${skipped} skipped, ${failed} failed\n`,
);
if (failed > 0) process.exitCode = 1;
