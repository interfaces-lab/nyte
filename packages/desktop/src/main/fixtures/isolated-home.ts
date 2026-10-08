/**
 * Vitest setup: each desktop test file runs against its own empty home, set before
 * the file imports anything. Host paths derive from `homedir()` and the overrides
 * below, so an inherited value would point a test at this machine's real sessions,
 * skills, and agent transcripts. A test's own `vi.stubEnv` still wins, and
 * `vi.unstubAllEnvs()` returns to this home rather than the real one.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

const home = join(realpathSync(tmpdir()), `nyte-desktop-home-${randomUUID()}`);

const inherited = new Map(
  [
    "HOME",
    "USERPROFILE",
    "NYTE_HOME",
    "NYTE_BIN_DIR",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
  ].map((name) => [name, process.env[name]] as const),
);

for (const name of inherited.keys()) delete process.env[name];

process.env.HOME = home;

process.env.USERPROFILE = home;

// Created and removed by the file's hooks, which Vitest skips together when every test in the file is skipped.
beforeAll(() => {
  mkdirSync(home, { mode: 0o700 });
});

afterAll(() => {
  for (const [name, value] of inherited) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  rmSync(home, { recursive: true, force: true });
});
