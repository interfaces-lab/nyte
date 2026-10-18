import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { afterEach, assert, describe, expect, it } from "vitest";
import { loadPluginDirectory, loadPluginFiles, pluginLoader } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-plugins-")));
  folders.push(made);

  return made;
}

describe("loadPluginFiles", () => {
  it("loads each plugin file and directory index by name, and nothing from a missing directory", async () => {
    const dir = await folder();
    await writeFile(
      join(dir, "b-typed.ts"),
      'const id: string = "typed";\nexport default { id };\n',
    );
    await writeFile(join(dir, "a-plain.mjs"), 'export default { id: "plain", contribute: {} };\n');
    await mkdir(join(dir, "c-folder"));
    await writeFile(
      join(dir, "c-folder", "index.js"),
      'export default { id: "folder", activate() {} };\n',
    );
    await writeFile(join(dir, "notes.md"), "# not a plugin\n");
    const loaded = await loadPluginFiles(dir);

    expect(loaded.map(({ plugin, path }) => [plugin.id, path])).toEqual([
      ["plain", join(dir, "a-plain.mjs")],
      ["typed", join(dir, "b-typed.ts")],
      ["folder", join(dir, "c-folder", "index.js")],
    ]);
    expect(await loadPluginFiles(join(dir, "missing"))).toEqual([]);
  });

  it("loads a replaced file fresh, not from the module cache", async () => {
    const dir = await folder();
    const file = join(dir, "live.mjs");
    await writeFile(file, 'export default { id: "first" };\n');
    expect((await loadPluginFiles(dir))[0]?.plugin.id).toBe("first");

    await writeFile(file, 'export default { id: "second-version" };\n');
    expect((await loadPluginFiles(dir))[0]?.plugin.id).toBe("second-version");
  });

  it("reports every file that does not load or export a core plugin, together", async () => {
    const dir = await folder();
    await writeFile(join(dir, "good.mjs"), 'export default { id: "good" };\n');
    await writeFile(join(dir, "number.mjs"), "export default 42;\n");
    await writeFile(join(dir, "broken.mjs"), "export default {;\n");
    await writeFile(
      join(dir, "provider.mjs"),
      'export default { id: "p", environment: { kind: 1 } };\n',
    );
    const failure = await loadPluginFiles(dir).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "invalid" });
    assert(typeof failure === "object" && failure !== null && "issues" in failure);
    expect(failure.issues).toEqual([
      expect.objectContaining({ severity: "error", path: [join(dir, "broken.mjs")] }),
      expect.objectContaining({ path: [join(dir, "number.mjs")] }),
      expect.objectContaining({ path: [join(dir, "provider.mjs")] }),
    ]);
  });
});

describe("loadPluginDirectory", () => {
  it("loads file by file: a good file loads, a bad one is reported by path, a missing directory has neither", async () => {
    const dir = await folder();
    await writeFile(join(dir, "good.mjs"), 'export default { id: "good" };\n');
    await writeFile(join(dir, "bad.mjs"), "export default {;\n");
    const { loaded, failed } = await loadPluginDirectory(dir);

    expect(loaded.map(({ plugin, path }) => [plugin.id, path])).toEqual([
      ["good", join(dir, "good.mjs")],
    ]);
    expect(failed).toEqual([
      {
        path: join(dir, "bad.mjs"),
        issue: expect.objectContaining({
          severity: "error",
          path: [join(dir, "bad.mjs")],
          source: { plugin: join(dir, "bad.mjs"), file: join(dir, "bad.mjs") },
        }),
      },
    ]);
    expect(await loadPluginDirectory(join(dir, "missing"))).toEqual({ loaded: [], failed: [] });
  });
});

describe("pluginLoader", () => {
  it("loads wire paths inside its directories in path order and denies the rest", async () => {
    const dir = await folder();
    const elsewhere = await folder();
    await writeFile(join(dir, "z.mjs"), 'export default { id: "z" };\n');
    await writeFile(join(dir, "a.mjs"), 'export default { id: "a" };\n');
    await writeFile(join(elsewhere, "x.mjs"), 'export default { id: "x" };\n');
    const load = pluginLoader([dir, join(dir, "not-there")]);

    expect(
      (await load([join(dir, "z.mjs"), join(dir, "a.mjs")])).map((plugin) => plugin.id),
    ).toEqual(["z", "a"]);
    await expect(load([join(elsewhere, "x.mjs")])).rejects.toMatchObject({ code: "denied" });
    await expect(load([join(dir, "..", basename(elsewhere), "x.mjs")])).rejects.toMatchObject({
      code: "denied",
    });
    await expect(load([join(dir, "missing.mjs")])).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("plugin sources on the host view (§41e)", () => {
  it("shows a loaded plugin's scope (user or project) and path, an inline plugin as inline", async () => {
    const dir = await folder();
    const home = await folder();
    await writeFile(join(dir, "mine.mjs"), 'export default { id: "mine" };\n');
    await writeFile(join(home, "theirs.mjs"), 'export default { id: "theirs" };\n');
    const [loaded] = await loadPluginFiles(dir);
    const [user] = await loadPluginFiles(home);
    assert(loaded !== undefined && user !== undefined);

    const host = await composeHost({
      store: memoryStore(),
      models: fakeModels().models,
      plugins: [chatOnly, loaded.plugin, user.plugin],
      pluginSources: new Map([
        [loaded.plugin, { source: "project", path: loaded.path }],
        [user.plugin, { source: "user", path: user.path }],
      ]),
      workspace: { kind: "chat-only", locator: null },
      home: null,
      description: { name: "test", platform: "darwin", version: "0.1.0" },
    });

    expect(host.server.pluginRows().filter((row) => row.source !== "builtin")).toEqual([
      { id: "chat-only", source: "inline", path: null, issues: [] },
      { id: "mine", source: "project", path: join(dir, "mine.mjs"), issues: [] },
      { id: "theirs", source: "user", path: join(home, "theirs.mjs"), issues: [] },
    ]);
    await host.close();
  });
});
