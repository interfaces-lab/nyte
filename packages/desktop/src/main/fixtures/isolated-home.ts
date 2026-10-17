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
