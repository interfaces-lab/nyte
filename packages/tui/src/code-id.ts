import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compiled } from "./compiled.ts";

/** The code id the build script embeds in the compiled binary, empty when git couldn't give one; source never reads it. */
declare const NYTE_BUILT_CODE_ID: string;

/** How long one git command may take before the code id falls back to none. */
const GIT_TIMEOUT_MS = 2_000;

let reading: Promise<string | undefined> | undefined;

/**
 * Returns the id of the code this nyte runs, which goes into the service build: the compiled
 * binary's is the one `hashSourceTree` gave when it was built, and from source it is
 * `hashSourceTree` over `packages/` now. Undefined when neither is known.
 */
export function readCodeId(): Promise<string | undefined> {
  reading ??= compiled
    ? Promise.resolve(NYTE_BUILT_CODE_ID === "" ? undefined : NYTE_BUILT_CODE_ID)
    : hashSourceTree(fileURLToPath(new URL("../../", import.meta.url)));

  return reading;
}

/**
 * Returns the id of the code under `directory`, inside a git checkout: the first 12 hex digits
 * of HEAD and, when `directory` differs from HEAD, a `.` and the first 8 hex digits of the
 * SHA-256 over `git diff HEAD` and each untracked, unignored file's path and content. Two
 * calls over the same tree give the same id. Undefined when git can't answer.
 */
export async function hashSourceTree(directory: string): Promise<string | undefined> {
  try {
    const [head, diff, untracked] = await Promise.all([
      git(directory, ["rev-parse", "HEAD"]),
      git(directory, ["diff", "HEAD", "--no-ext-diff", "--no-color", "--", "."]),
      git(directory, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."]),
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
