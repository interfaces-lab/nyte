import { mkdtemp, realpath, rename, rm, stat, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { folderIdentity } from "../src/local/identity.ts";

vi.mock("node:fs/promises", { spy: true });

const folders: string[] = [];

afterEach(async () => {
  vi.mocked(stat).mockReset();

  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it("keeps a folder's identity when the operating system assigns another device number", async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-identity-")));
  folders.push(folder);
  const metadata = await stat(folder, { bigint: true });
  vi.mocked(stat).mockResolvedValueOnce(metadata);
  const before = await folderIdentity(folder);
  metadata.dev += 1n;
  vi.mocked(stat).mockResolvedValueOnce(metadata);

  expect(await folderIdentity(folder)).toBe(before);
  expect(before).toMatch(/^[0-9a-f]{64}$/);
});

it("keeps identity through aliases and renames but distinguishes a replacement at the same path", async () => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-identity-")));
  folders.push(folder);
  const project = join(folder, "project");
  await mkdir(project);
  await symlink(project, join(folder, "alias"));
  const original = await folderIdentity(project);

  expect(await folderIdentity(join(folder, "alias"))).toBe(original);
  await rename(project, join(folder, "moved"));
  expect(await folderIdentity(join(folder, "moved"))).toBe(original);
  await mkdir(project);
  expect(await folderIdentity(project)).not.toBe(original);
  expect(await folderIdentity(project)).toMatch(/^[0-9a-f]{64}$/);
});
