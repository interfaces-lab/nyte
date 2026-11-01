#!/usr/bin/env node
/**
 * Proves `pnpm --dir packages/desktop dev` opens a window: starts it with
 * Chromium's remote debugging on, waits for a renderer page to load, checks
 * it is still there a few seconds later, then stops the app. On Linux run it
 * under xvfb-run. Uses a throwaway store, so it never touches ~/.nyte.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env["SMOKE_DEBUG_PORT"] ?? 9333);

const TIMEOUT_MS = Number(process.env["SMOKE_TIMEOUT_MS"] ?? 5 * 60_000);

const STABLE_MS = 5_000;

const home = mkdtempSync(join(tmpdir(), "nyte-desktop-smoke-"));

const output = [];

const child = spawn(
  "pnpm",
  ["--dir", "packages/desktop", "dev", "--remoteDebuggingPort", String(PORT)],
  {
    detached: true,
    env: { ...process.env, NYTE_DB: join(home, "nyte-dev.db"), NYTE_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

/** @type {string | undefined} How the dev command ended, once it has. */
let exited;

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    output.push(...chunk.toString().split("\n"));
    output.splice(0, Math.max(0, output.length - 60));
  });
}

child.once("exit", (code, signal) => {
  exited = String(signal ?? code);
});

/** Renderer pages the app has loaded, from the DevTools endpoint. */
async function pages() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();

    return targets.filter(
      (target) =>
        target.type === "page" &&
        !target.url.startsWith("devtools://") &&
        target.url !== "about:blank",
    );
  } catch {
    return [];
  }
}

/** Stops the dev command and the Electron it started; a group already gone throws, which is fine. */
function stop() {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}

let result = 1;

try {
  const deadline = Date.now() + TIMEOUT_MS;
  let found = [];

  while (Date.now() < deadline && exited === undefined) {
    found = await pages();

    if (found.length > 0) break;
    await sleep(1_000);
  }

  if (found.length === 0) {
    process.stderr.write(
      exited === undefined
        ? `\nNo window loaded within ${TIMEOUT_MS / 1000}s.\n`
        : `\npnpm --dir packages/desktop dev exited (${exited}) before a window loaded.\n`,
    );
  } else {
    await sleep(STABLE_MS);
    const still = await pages();

    if (still.length === 0 || exited !== undefined) {
      process.stderr.write("\nThe window loaded, then went away.\n");
    } else {
      process.stdout.write(
        `\nDesktop dev opened ${still.map((page) => `"${page.title}" (${page.url})`).join(", ")}.\n`,
      );
      result = 0;
    }
  }
} finally {
  stop();
  await sleep(1_000);
  rmSync(home, { recursive: true, force: true });
}

if (result !== 0) process.stderr.write(`\nLast output:\n${output.join("\n")}\n`);

process.exit(result);
