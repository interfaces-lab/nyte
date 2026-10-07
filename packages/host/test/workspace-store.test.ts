import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceTrustMode } from "@nyte-ai/core";
import { afterEach, test } from "vitest";
import { WorkspaceStore } from "../src/workspace-store.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("separate store instances preserve trust during concurrent writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-workspace-store-"));
  roots.push(root);
  const trusted = join(root, "trusted");
  const recent = join(root, "recent");
  await Promise.all([mkdir(trusted), mkdir(recent)]);
  const path = join(root, "workspaces.json");
  const first = new WorkspaceStore(path);
  const second = new WorkspaceStore(path);

  await Promise.all([first.trust(trusted), second.touch(recent, 100)]);

  const trustedPath = await realpath(trusted);
  const recentPath = await realpath(recent);
  assert.equal((await first.require(trusted)).cwd, trustedPath);
  assert.deepEqual(
    (await second.list()).map((workspace) => workspace.path).toSorted(),
    [recentPath, trustedPath].toSorted(),
  );
});

test("trust is asked only for a folder with project input; always and never answer without asking", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-workspace-store-"));
  roots.push(root);
  const plain = join(root, "plain");
  const withSkills = join(root, "with-skills");
  await Promise.all([
    mkdir(plain),
    mkdir(join(withSkills, ".agents", "skills"), { recursive: true }),
  ]);
  let mode: WorkspaceTrustMode = "ask";
  const store = new WorkspaceStore(join(root, "workspaces.json"), { mode: () => mode });

  assert.equal((await store.resolve(plain)).kind, "trusted");
  assert.deepEqual(await store.resolve(withSkills), {
    kind: "unknown",
    cwd: await realpath(withSkills),
  });

  mode = "always";
  assert.equal((await store.resolve(withSkills)).kind, "trusted");

  mode = "never";
  const restricted = await store.resolve(withSkills);
  assert.equal(restricted.kind === "trusted" && restricted.workspace.projectInput, false);

  await store.trust(withSkills);
  const granted = await store.resolve(withSkills);
  assert.equal(granted.kind === "trusted" && granted.workspace.projectInput, true);

  mode = "ask";
  assert.equal((await store.resolve(withSkills)).kind, "trusted");
});
