import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";
import { codemodePlugin } from "./codemode-plugin.ts";
import { BINARY_ENTRYPOINTS } from "./defines.ts";

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
    return cause.errors.map((error) => describe(error)).join("; ");
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
    entrypoints: BINARY_ENTRYPOINTS.map((entry) => join(packages, entry)),
    root: packages,
    target: "bun",
    plugins: [solidPlugin, codemodePlugin],
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
