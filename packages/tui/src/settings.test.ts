import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJsonValue } from "@nyte-ai/core/store";
import { createScrollAcceleration } from "./scrolling.ts";
import { FileSettingsStore, parseSettingsFile } from "./settings.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("scroll settings", () => {
  test("the fixed policy stays at three rows and acceleration responds to event timing", () => {
    const fixed = createScrollAcceleration(false);
    expect(fixed.tick(0)).toBe(3);
    expect(fixed.tick(10)).toBe(3);
    expect(fixed.tick(20)).toBe(3);

    const accelerated = createScrollAcceleration(true);
    expect(accelerated.tick(1_000)).toBe(1);
    const steady = accelerated.tick(1_100);
    expect(steady).toBeGreaterThan(1);
    expect(accelerated.tick(1_110)).toBeGreaterThan(steady);
    expect(accelerated.tick(1_300)).toBe(1);
    accelerated.reset();
    expect(accelerated.tick(1_310)).toBe(1);
  });

  test("parses only a boolean scrollAcceleration setting", () => {
    expect(parseSettingsFile({ scrollAcceleration: true })).toEqual({
      scrollAcceleration: true,
    });
    expect(() => parseSettingsFile({ scrollAcceleration: "on" })).toThrow(
      "settings.scrollAcceleration must be a boolean",
    );
  });

  test("defaults to fixed scrolling and persists a global acceleration choice", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyte-tui-settings-"));
    temporaryDirectories.push(root);
    const globalPath = join(root, "home", "settings.json");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const store = new FileSettingsStore(globalPath);

    expect((await store.read(workspace)).scrollAcceleration).toBe(false);
    await store.updateGlobal({ scrollAcceleration: true });
    expect((await store.read(workspace)).scrollAcceleration).toBe(true);
    const saved = toJsonValue(JSON.parse(await readFile(globalPath, "utf8")));
    expect(parseSettingsFile(saved)).toEqual({ scrollAcceleration: true });

    await mkdir(join(workspace, ".nyte"), { recursive: true });
    await writeFile(
      join(workspace, ".nyte", "settings.json"),
      `${JSON.stringify({ scrollAcceleration: false })}\n`,
    );
    expect((await store.read(workspace)).scrollAcceleration).toBe(false);
  });
});

test("copy-on-select uses the platform default and respects saved overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-tui-copy-settings-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, ".nyte"), { recursive: true });
  const store = new FileSettingsStore(join(root, "settings.json"));

  expect((await store.read(workspace)).copyOnSelect).toBe(process.platform !== "win32");
  await store.updateGlobal({ copyOnSelect: false });
  expect((await store.read(workspace)).copyOnSelect).toBe(false);
  await store.updateGlobal({ copyOnSelect: true });
  expect((await store.read(workspace)).copyOnSelect).toBe(true);
  await writeFile(join(workspace, ".nyte", "settings.json"), '{"copyOnSelect":false}\n');
  expect((await store.read(workspace)).copyOnSelect).toBe(false);
});
