import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Interrupted } from "./engine.js";

/**
 * Appends every command and its output to ~/.nyte/logs/init-<time>.log, mode
 * 0600. nyte triage reads these and redacts them before anything leaves the
 * machine. A log that can't be written never stops setup.
 */
export function openLog(home, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
  const directory = join(home, ".nyte", "logs");
  const path = join(directory, `init-${stamp}.log`);
  let ready = false;

  return {
    path,
    write(text) {
      try {
        if (!ready) {
          mkdirSync(directory, { recursive: true });
          ready = true;
        }

        appendFileSync(path, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
      } catch {}
    },
  };
}

/**
 * Runs commands with init's environment.
 *
 * `capture` runs one quietly for a check and never throws: a missing command
 * returns code 127. `run` runs one for a step: output streams to `onLine` and
 * the log, or with `inherit` straight to the terminal for a vendor tool that
 * prompts, and it throws when the command exits non-zero.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} options.env
 * @param {{ write(text: string): void }} options.log
 */
export function createExec({ env, log }) {
  function capture(command, args = [], { cwd } = {}) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.once("error", () => resolve({ code: 127, stdout, stderr }));
      child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }

  function run(command, args = [], { cwd, onLine, inherit = false } = {}) {
    log.write(`$ ${[command, ...args].join(" ")}${cwd === undefined ? "" : `  (in ${cwd})`}`);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      });

      let tail = [];

      if (!inherit) {
        const onData = lines((line) => {
          log.write(line);
          onLine?.(line);
          tail = [...tail.slice(-19), line];
        });

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
      }

      child.once("error", (error) =>
        reject(new Error(`Couldn't run ${command}: ${error.message}`)),
      );
      child.once("close", (code, signal) => {
        log.write(`exit ${code ?? signal}`);

        if (signal === "SIGINT" || code === 130) {
          reject(new Interrupted(`${command} stopped`));

          return;
        }

        if (code === 0) resolve(undefined);
        else {
          const detail = tail.length === 0 ? "" : `\n${tail.join("\n")}`;
          reject(new Error(`${[command, ...args].join(" ")} exited ${code ?? signal}.${detail}`));
        }
      });
    });
  }

  return { capture, run };
}

/** Splits a byte stream into lines, dropping carriage-return progress redraws. */
function lines(onLine) {
  let buffer = "";

  return (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.split("\r").pop()?.trimEnd() ?? "";

      if (line !== "") onLine(line);
    }
  };
}

const GITHUB_API = "https://api.github.com";

/** The newest release of a GitHub repository: its tag and asset download URLs. */
export async function latestRelease(repository, fetchFn = globalThis.fetch) {
  const response = await fetchFn(`${GITHUB_API}/repos/${repository}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Couldn't read the latest ${repository} release (HTTP ${response.status}).`);
  }

  const release = await response.json();
  const assets = new Map(release.assets.map((asset) => [asset.name, asset.browser_download_url]));

  return { tag: release.tag_name, assets };
}

/** The SHA-256 listed for `name` in a `<hash>  <name>` checksum file. */
export function checksumFor(listing, name) {
  for (const line of listing.split("\n")) {
    const [hash, file] = line.trim().split(/\s+/u);

    if (file?.replace(/^\*/u, "") === name && /^[0-9a-f]{64}$/iu.test(hash ?? "")) {
      return hash.toLowerCase();
    }
  }

  throw new Error(`The checksum file doesn't list ${name}.`);
}

/** Downloads `url` to `path` and fails unless its SHA-256 is `expected`. */
export async function downloadVerified(url, path, expected, fetchFn = globalThis.fetch) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10 * 60_000) });

  if (!response.ok) throw new Error(`Couldn't download ${url} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");

  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${url}: expected ${expected}, got ${actual}.`);
  }

  await writeFile(path, bytes);
}

/** Installs an executable atomically, so a half-written file is never on PATH. */
export async function installExecutable(source, destination) {
  await mkdir(join(destination, ".."), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, await readFile(source));
  await chmod(temporary, 0o755);
  await rename(temporary, destination);
}

export async function removeQuietly(path) {
  await rm(path, { recursive: true, force: true });
}
