import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, assert, describe, expect, it } from "vitest";
import { createPluginLoader } from "../src/index.ts";
import type { PluginLoader } from "../src/index.ts";

const run = promisify(execFile);

const folders: string[] = [];

const loaders: PluginLoader[] = [];

afterEach(async () => {
  for (const loader of loaders.splice(0)) loader.close();

  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-plugins-")));
  folders.push(made);

  return made;
}

/** Runs `script` in a plain Node process, with `createPluginLoader`, `mkdir` and `writeFile` in scope, and parses what it prints. Under Vitest a plugin's imports go through Vitest's module runner, not Node's loader and the resolve hook that reloads a plugin's helpers. */
async function inNode(script: string): Promise<unknown> {
  const loader = new URL("../src/plugins/loader.ts", import.meta.url);

  const result = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { mkdir, writeFile } from "node:fs/promises";\nimport { createPluginLoader } from ${JSON.stringify(loader.href)};\n${script}`,
  ]);

  return JSON.parse(result.stdout);
}

function loaderOver(...dirs: string[]): PluginLoader {
  const loader = createPluginLoader({ dirs: async () => dirs });
  loaders.push(loader);

  return loader;
}

describe("directory", () => {
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
    const loader = loaderOver(dir);
    const found = await loader.directory(dir);

    expect(found.loaded.map((entry) => [entry.plugin.id, entry.path])).toEqual([
      ["plain", join(dir, "a-plain.mjs")],
      ["typed", join(dir, "b-typed.ts")],
      ["folder", join(dir, "c-folder", "index.js")],
    ]);
    expect(found.failed).toEqual([]);
    expect(await loader.directory(join(dir, "missing"))).toEqual({ loaded: [], failed: [] });
  });

  it("loads file by file: a good file loads, a bad one is reported by path", async () => {
    const dir = await folder();
    await writeFile(join(dir, "good.mjs"), 'export default { id: "good" };\n');
    await writeFile(join(dir, "bad.mjs"), "export default {;\n");
    const found = await loaderOver(dir).directory(dir);

    expect(found.loaded.map((entry) => [entry.plugin.id, entry.path])).toEqual([
      ["good", join(dir, "good.mjs")],
    ]);
    expect(found.failed).toEqual([
      {
        path: join(dir, "bad.mjs"),
        issue: expect.objectContaining({
          severity: "error",
          path: [join(dir, "bad.mjs")],
          source: { plugin: join(dir, "bad.mjs"), file: join(dir, "bad.mjs") },
        }),
      },
    ]);
  });

  it("loads a replaced file fresh, not from the module cache", async () => {
    const dir = await folder();
    const file = join(dir, "live.mjs");
    const loader = loaderOver(dir);
    await writeFile(file, 'export default { id: "first" };\n');
    expect((await loader.directory(dir)).loaded[0]?.plugin.id).toBe("first");

    await writeFile(file, 'export default { id: "second-version" };\n');
    expect((await loader.directory(dir)).loaded[0]?.plugin.id).toBe("second-version");
  });

  it("loads a plugin fresh when a helper its index imports changes", async () => {
    const dir = await folder();
    await mkdir(join(dir, "helped"));
    await writeFile(
      join(dir, "helped", "index.mjs"),
      'import { id } from "./id.mjs";\nexport default { id };\n',
    );
    await writeFile(join(dir, "helped", "id.mjs"), 'export const id = "one";\n');

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const before = await loader.directory(${JSON.stringify(dir)});
        await writeFile(${JSON.stringify(join(dir, "helped", "id.mjs"))}, 'export const id = "two";\\n');
        const after = await loader.directory(${JSON.stringify(dir)});
        loader.close();
        console.log(JSON.stringify([before.loaded[0]?.plugin.id, after.loaded[0]?.plugin.id]));
      `),
    ).toEqual(["one", "two"]);
  });

  it("loads a plugin fresh when a helper it could not import appears", async () => {
    const dir = await folder();
    await mkdir(join(dir, "pending"));
    await writeFile(
      join(dir, "pending", "index.mjs"),
      'import { id } from "./id.mjs";\nexport default { id };\n',
    );

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const before = await loader.directory(${JSON.stringify(dir)});
        await writeFile(${JSON.stringify(join(dir, "pending", "id.mjs"))}, 'export const id = "arrived";\\n');
        const after = await loader.directory(${JSON.stringify(dir)});
        loader.close();
        console.log(JSON.stringify([before.failed.length, after.loaded[0]?.plugin.id]));
      `),
    ).toEqual([1, "arrived"]);
  });

  it("answers the same plugin object while nothing in its graph changed", async () => {
    const dir = await folder();
    await mkdir(join(dir, "steady"));
    await writeFile(
      join(dir, "steady", "index.mjs"),
      'import { id } from "./id.mjs";\nexport default { id };\n',
    );
    await writeFile(join(dir, "steady", "id.mjs"), 'export const id = "steady";\n');
    const loader = loaderOver(dir);
    const first = (await loader.directory(dir)).loaded[0]?.plugin;
    assert(first !== undefined);

    expect((await loader.directory(dir)).loaded[0]?.plugin).toBe(first);
    expect(await loader.load([join(dir, "steady", "index.mjs")])).toEqual([first]);
  });

  it("loads a plugin fresh when a helper changed while its import was still evaluating", async () => {
    const dir = await folder();
    await mkdir(join(dir, "slow"));
    await writeFile(
      join(dir, "slow", "index.mjs"),
      'import { id } from "./id.mjs";\nawait new Promise((resolve) => setTimeout(resolve, 300));\nexport default { id };\n',
    );
    await writeFile(join(dir, "slow", "id.mjs"), 'export const id = "old";\n');

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const first = loader.directory(${JSON.stringify(dir)});
        await new Promise((resolve) => setTimeout(resolve, 100));
        await writeFile(${JSON.stringify(join(dir, "slow", "id.mjs"))}, 'export const id = "new";\\n');
        const during = (await first).loaded[0]?.plugin.id;
        const after = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin.id;
        loader.close();
        console.log(JSON.stringify([during, after]));
      `),
    ).toEqual(["old", "new"]);
  });

  it("answers concurrent loads of an unchanged file with one plugin object", async () => {
    const dir = await folder();
    await writeFile(join(dir, "shared.mjs"), 'export default { id: "shared" };\n');
    const loader = loaderOver(dir);
    const both = await Promise.all([loader.directory(dir), loader.directory(dir)]);
    const first = both[0].loaded[0]?.plugin;
    assert(first !== undefined);

    expect(both[1].loaded[0]?.plugin).toBe(first);
  });

  it("loads a plugin whose missing package was installed after it failed", async () => {
    const dir = await folder();
    await writeFile(
      join(dir, "needs.mjs"),
      'import { id } from "late-package";\nexport default { id };\n',
    );
    const pkg = join(dir, "node_modules", "late-package");

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const before = await loader.directory(${JSON.stringify(dir)});
        await mkdir(${JSON.stringify(pkg)}, { recursive: true });
        await writeFile(${JSON.stringify(join(pkg, "package.json"))}, '{ "name": "late-package", "type": "module", "exports": "./index.js" }');
        await writeFile(${JSON.stringify(join(pkg, "index.js"))}, 'export const id = "installed";\\n');
        const after = await loader.directory(${JSON.stringify(dir)});
        loader.close();
        console.log(JSON.stringify([before.failed.length, after.loaded[0]?.plugin.id]));
      `),
    ).toEqual([1, "installed"]);
  });

  it("shares a linked package with the host and does not reload the plugin when it changes", async () => {
    const dir = await folder();
    const linked = await folder();
    await writeFile(
      join(linked, "package.json"),
      '{ "name": "linked", "type": "module", "exports": "./index.js" }',
    );
    await writeFile(join(linked, "index.js"), "export const shared = {};\n");
    await mkdir(join(dir, "node_modules"));
    await symlink(linked, join(dir, "node_modules", "linked"), "dir");
    await writeFile(
      join(dir, "uses.mjs"),
      'import { shared } from "linked";\nexport default { id: "uses", shared };\n',
    );

    expect(
      await inNode(`
        const direct = await import(${JSON.stringify(pathToFileURL(join(linked, "index.js")).href)});
        const loader = createPluginLoader({ dirs: async () => [] });
        const first = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        await writeFile(${JSON.stringify(join(linked, "index.js"))}, 'export const shared = {};\\nexport const edited = true;\\n');
        const after = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        loader.close();
        console.log(JSON.stringify([first?.shared === direct.shared, after === first]));
      `),
    ).toEqual([true, true]);
  });

  it("loads a plugin fresh when a helper its activate imported changes", async () => {
    const dir = await folder();
    await mkdir(join(dir, "lazy"));
    await writeFile(
      join(dir, "lazy", "index.mjs"),
      'export default { id: "lazy", async activate() { await import("./helper.mjs"); } };\n',
    );
    await writeFile(join(dir, "lazy", "helper.mjs"), "export const value = 1;\n");

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const first = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        await first.activate();
        const steady = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        await writeFile(${JSON.stringify(join(dir, "lazy", "helper.mjs"))}, 'export const value = 2;\\n');
        const after = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        loader.close();
        console.log(JSON.stringify([steady === first, after !== first]));
      `),
    ).toEqual([true, true]);
  });

  it("loads a plugin fresh after a failed edit is reverted, and tracks what its activate imports", async () => {
    const dir = await folder();
    const entry = join(dir, "lazy", "index.mjs");

    const source =
      'export default { id: "lazy", async activate() { await import("./helper.mjs"); } };\n';

    await mkdir(join(dir, "lazy"));
    await writeFile(entry, source);
    await writeFile(join(dir, "lazy", "helper.mjs"), "export const value = 1;\n");

    expect(
      await inNode(`
        const loader = createPluginLoader({ dirs: async () => [] });
        const first = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        await writeFile(${JSON.stringify(entry)}, "export default {;\\n");
        const broken = await loader.directory(${JSON.stringify(dir)});
        await writeFile(${JSON.stringify(entry)}, ${JSON.stringify(source)});
        const reverted = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        await reverted.activate();
        await writeFile(${JSON.stringify(join(dir, "lazy", "helper.mjs"))}, 'export const value = 2;\\n');
        const after = (await loader.directory(${JSON.stringify(dir)})).loaded[0]?.plugin;
        loader.close();
        console.log(JSON.stringify([broken.failed.length, reverted !== first, after !== reverted]));
      `),
    ).toEqual([1, true, true]);
  });

  it("follows symlinked plugin files and folders inside the directory, not ones pointing outside", async () => {
    const dir = await folder();
    const outside = await folder();
    await mkdir(join(dir, "store", "folder"), { recursive: true });
    await writeFile(join(dir, "store", "file.mjs"), 'export default { id: "linked-file" };\n');
    await writeFile(
      join(dir, "store", "folder", "index.mjs"),
      'export default { id: "linked-folder" };\n',
    );
    await mkdir(join(outside, "folder"));
    await writeFile(join(outside, "file.mjs"), 'export default { id: "outside-file" };\n');
    await writeFile(join(outside, "folder", "index.mjs"), 'export default { id: "outside" };\n');
    await symlink(join(dir, "store", "file.mjs"), join(dir, "linked-file.mjs"));
    await symlink(join(dir, "store", "folder"), join(dir, "linked-folder"), "dir");
    await symlink(join(outside, "file.mjs"), join(dir, "outside-file.mjs"));
    await symlink(join(outside, "folder"), join(dir, "outside-folder"), "dir");
    const found = await loaderOver(dir).directory(dir);

    expect(found.loaded.map((entry) => [entry.plugin.id, entry.path])).toEqual([
      ["linked-file", join(dir, "linked-file.mjs")],
      ["linked-folder", join(dir, "linked-folder", "index.mjs")],
    ]);
    expect(found.failed).toEqual([]);
  });
});

describe("load", () => {
  it("loads wire paths inside its directories in path order and denies the rest", async () => {
    const dir = await folder();
    const elsewhere = await folder();
    await writeFile(join(dir, "z.mjs"), 'export default { id: "z" };\n');
    await writeFile(join(dir, "a.mjs"), 'export default { id: "a" };\n');
    await writeFile(join(elsewhere, "x.mjs"), 'export default { id: "x" };\n');
    const loader = loaderOver(dir, join(dir, "not-there"));

    expect(
      (await loader.load([join(dir, "z.mjs"), join(dir, "a.mjs")])).map((plugin) => plugin.id),
    ).toEqual(["z", "a"]);
    await expect(loader.load([join(elsewhere, "x.mjs")])).rejects.toMatchObject({
      code: "denied",
    });
    await expect(
      loader.load([join(dir, "..", basename(elsewhere), "x.mjs")]),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(loader.load([join(dir, "missing.mjs")])).rejects.toMatchObject({
      code: "invalid",
    });
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

    const failure = await loaderOver(dir)
      .load(["broken.mjs", "good.mjs", "number.mjs", "provider.mjs"].map((name) => join(dir, name)))
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "invalid" });
    assert(typeof failure === "object" && failure !== null && "issues" in failure);
    expect(failure.issues).toEqual([
      expect.objectContaining({ severity: "error", path: [join(dir, "broken.mjs")] }),
      expect.objectContaining({ path: [join(dir, "number.mjs")] }),
      expect.objectContaining({ path: [join(dir, "provider.mjs")] }),
    ]);
  });
});
