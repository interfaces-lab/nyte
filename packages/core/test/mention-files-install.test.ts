import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { discoverMentionFiles } from "../src/mention-files.ts";

test("propagates an unusable ripgrep installation directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-mention-install-"));
  const home = join(root, "not-a-directory");
  await writeFile(home, "blocked");
  vi.stubEnv("PATH", root);
  vi.stubEnv("NYTE_HOME", home);
  try {
    await assert.rejects(discoverMentionFiles(root), { code: "ENOTDIR" });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
