import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { environmentId } from "../src/index.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function home(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-environment-id-")));
  directories.push(root);
  const path = join(root, "home");
  vi.stubEnv("NYTE_HOME", path);
  return path;
}

test("concurrent first reads converge on one stored v4 UUID", async () => {
  const path = await home();
  const ids = await Promise.all(Array.from({ length: 8 }, () => environmentId()));
  const [id] = ids;
  assert.equal(new Set(ids).size, 1);
  assert.match(id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await environmentId(), id);
  assert.deepEqual(await readdir(path), ["environment-id"]);
});

test("a corrupt id fails closed and is never replaced", async () => {
  const path = await home();
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "environment-id"), "not-a-uuid\n");
  await assert.rejects(environmentId(), /Corrupt environment id/);
  assert.equal(await readFile(join(path, "environment-id"), "utf8"), "not-a-uuid\n");
});
