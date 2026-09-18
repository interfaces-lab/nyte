import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { SqliteStore } from "@nyte-ai/core/store";
import { WorkspaceStore, workspaceStorePath } from "@nyte-ai/host";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-workspaces-")));
  directories.push(root);
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  return root;
}

test("desktop imports committed WAL history once and retains it after the project is deleted", async () => {
  const root = await fixture();
  const cwd = join(root, "project");
  const legacy = new SqliteStore(join(cwd, ".nyte", "sessions.db"));
  try {
    await (await legacy.create({ id: "existing-chat" })).close();
    const path = await workspaceStorePath(cwd);
    const local = new SqliteStore(path);
    try {
      assert.deepEqual(
        (await local.list()).map((session) => session.id),
        ["existing-chat"],
      );
      await (await local.create({ id: "desktop-chat" })).close();
    } finally {
      await local.close();
    }
    assert.deepEqual(
      (await legacy.list()).map((session) => session.id),
      ["existing-chat"],
    );
    assert.equal(await workspaceStorePath(cwd), path);
  } finally {
    await legacy.close();
  }
  await rm(cwd, { recursive: true });
  const reopened = new SqliteStore(await workspaceStorePath(cwd));
  try {
    assert.deepEqual(
      (await reopened.list()).map((session) => session.id),
      ["existing-chat", "desktop-chat"],
    );
    await assert.rejects(access(cwd));
  } finally {
    await reopened.close();
  }
});

test("missing and non-directory projects can have separate local histories without creating the folders", async () => {
  const root = await fixture();
  const missing = join(root, "missing");
  const file = join(root, "file");
  await writeFile(file, "not a directory");
  const missingPath = await workspaceStorePath(missing);
  const filePath = await workspaceStorePath(file);
  assert.notEqual(missingPath, filePath);
  const store = new SqliteStore(missingPath);
  await store.close();
  await assert.rejects(access(missing));
});

test("the store keeps unavailable workspaces and updates their availability after restoration", async () => {
  const root = await fixture();
  const cwd = join(root, "project");
  const registry = new WorkspaceStore(join(root, "registry.json"));
  await registry.touch(cwd, 100);
  assert.deepEqual(await registry.list(), [
    { path: cwd, name: "project", lastOpenedAt: 100, available: false },
  ]);
  await mkdir(cwd);
  assert.equal((await registry.list())[0]?.available, true);
  await rm(cwd, { recursive: true });
  await registry.touch(cwd, 200);
  assert.equal((await registry.list())[0]?.lastOpenedAt, 200);
  await registry.forget(cwd);
  assert.deepEqual(await registry.list(), []);
});
