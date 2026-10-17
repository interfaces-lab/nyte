import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { compiled } from "./compiled.ts";

/** The code id the build script embeds in the compiled binary, empty when git couldn't give one; source never reads it. */
declare const NYTE_BUILT_CODE_ID: string;

/** How long one git command may take before the code id falls back to none. */
const GIT_TIMEOUT_MS = 2_000;

/** The workspace packages whose code the service runs, with everything they depend on. */
const SERVICE_ROOTS = ["@nyte-ai/host", "@nyte-ai/service"];

/** The TUI module the service's host thread starts from; its relative imports run in the service too. */
const HOST_ENTRY = "packages/tui/src/host-worker.ts";

/** The part of a workspace package.json the service-path walk reads. */
const Manifest = Compile(
  Type.Object({
    name: Type.String(),
    dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
);

const RELATIVE_IMPORT = /from\s+"(\.{1,2}\/[^"]+\.ts)"/g;

let reading: Promise<string | undefined> | undefined;

/**
 * Returns the id of the code this nyte runs, which goes into the service build: the compiled
 * binary's is the one `hashSourceTree` gave when it was built, and from source it is
 * `hashSourceTree` over the code the service runs now. Undefined when neither is known.
 */
export function readCodeId(): Promise<string | undefined> {
  reading ??= compiled
    ? Promise.resolve(NYTE_BUILT_CODE_ID === "" ? undefined : NYTE_BUILT_CODE_ID)
    : hashSourceTree(fileURLToPath(new URL("../../", import.meta.url)));

  return reading;
}

/**
 * Returns the id of the code the service runs from the checkout at `directory`: the first 12
 * hex digits of HEAD and, when that code differs from HEAD, a `.` and the first 8 hex digits of
 * the SHA-256 over `git diff HEAD` and each untracked, unignored file's path and content. Only
 * the `src` of the packages the service depends on and the TUI's host-thread modules count, so
 * editing a client, a test or a doc keeps the running service. Two calls over the same tree
 * give the same id. Undefined when git can't answer.
 */
export async function hashSourceTree(directory: string): Promise<string | undefined> {
  try {
    const [head, paths] = await Promise.all([
      git(directory, ["rev-parse", "HEAD"]),
      listServicePaths(directory),
    ]);

    const [diff, untracked] = await Promise.all([
      git(directory, ["diff", "HEAD", "--no-ext-diff", "--no-color", "--", ...paths]),
      git(directory, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...paths]),
    ]);

    const commit = head.trim().slice(0, 12);
    const files = untracked.split("\0").filter((file) => file !== "");

    if (diff === "" && files.length === 0) return commit;
    const hash = createHash("sha256").update(diff);

    for (const file of files)
      hash.update(`\0${file}\0`).update(await readFile(join(directory, file)).catch(() => ""));

    return `${commit}.${hash.digest("hex").slice(0, 8)}`;
  } catch {
    return undefined;
  }
}

/** Lists the checkout-relative paths of the code the service runs, following workspace dependencies from SERVICE_ROOTS and relative imports from HOST_ENTRY. */
async function listServicePaths(directory: string): Promise<readonly string[]> {
  const packages = new Map<string, readonly string[]>();
  const listing = await git(directory, ["ls-files", "-z", "--", "packages/*/package.json"]);

  const files = listing.split("\0").filter((entry) => entry !== "");

  const manifests = await Promise.all(
    files.map(async (file) => {
      const manifest: unknown = JSON.parse(await readFile(join(directory, file), "utf8"));

      return { file, manifest };
    }),
  );

  for (const { file, manifest } of manifests) {
    if (!Manifest.Check(manifest)) continue;

    packages.set(manifest.name, [dirname(file), ...Object.keys(manifest.dependencies ?? {})]);
  }

  const reached = new Set<string>();
  const pending = [...SERVICE_ROOTS];

  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const entry = packages.get(name);

    if (entry === undefined || reached.has(name)) continue;
    reached.add(name);
    pending.push(...entry.slice(1));
  }

  const paths = [...reached].flatMap((name) => {
    const entry = packages.get(name);

    return entry === undefined ? [] : [`${entry[0]}/src`];
  });

  const modules = new Set<string>();
  const queue = [HOST_ENTRY];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (modules.has(file)) continue;
    modules.add(file);

    const text = await readFile(join(directory, file), "utf8").catch(() => "");

    for (const match of text.matchAll(RELATIVE_IMPORT))
      queue.push(relative(directory, join(directory, dirname(file), match[1] ?? "")));
  }

  return [...paths, ...modules].toSorted();
}

function git(directory: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-optional-locks", "-C", directory, ...args],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
  });
}
