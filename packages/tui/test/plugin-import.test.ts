import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createPluginLoader } from "@nyte-ai/host";
import { bunPluginImport } from "../src/plugin-import.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function tempFolder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-plugin-import-")));
  folders.push(made);

  return made;
}

/** A plugin directory holding `helped/index.mjs`, whose id comes from `helped/id.mjs`. */
async function pluginDirectory(): Promise<string> {
  const dir = await tempFolder();
  await mkdir(join(dir, "helped"));
  await writeFile(
    join(dir, "helped", "index.mjs"),
    'import { id } from "./id.mjs";\nimport { join } from "node:path";\nexport default { id, join };\n',
  );
  await writeFile(join(dir, "helped", "id.mjs"), 'export const id = "one";\n');

  return dir;
}

test("imports a plugin's helpers fresh and lists its local graph, entry first", async () => {
  const dir = await pluginDirectory();
  const entry = join(dir, "helped", "index.mjs");
  const importPlugin = bunPluginImport();
  const first = await importPlugin(entry);

  expect([...first.files.keys()]).toEqual([entry, join(dir, "helped", "id.mjs")]);
  expect(first.result).toMatchObject({ kind: "module", module: { default: { id: "one" } } });

  await writeFile(join(dir, "helped", "id.mjs"), 'export const id = "two";\n');
  const second = await importPlugin(entry);

  expect(second.result).toMatchObject({ kind: "module", module: { default: { id: "two" } } });
});

test("a loader over it answers the same plugin until a helper changes", async () => {
  const dir = await pluginDirectory();
  const loader = createPluginLoader({ dirs: async () => [dir], import: bunPluginImport() });
  const first = (await loader.directory(dir)).loaded[0]?.plugin;

  expect(first?.id).toBe("one");
  expect((await loader.directory(dir)).loaded[0]?.plugin).toBe(first);

  await writeFile(join(dir, "helped", "id.mjs"), 'export const id = "two";\n');
  expect((await loader.directory(dir)).loaded[0]?.plugin.id).toBe("two");
  loader.close();
});

test("a loader over it loads a plugin once the helper it imports without an extension appears", async () => {
  const dir = await tempFolder();
  await mkdir(join(dir, "pending"));
  await writeFile(
    join(dir, "pending", "index.ts"),
    'import { id } from "./helper";\nexport default { id };\n',
  );
  const loader = createPluginLoader({ dirs: async () => [dir], import: bunPluginImport() });

  expect((await loader.directory(dir)).failed).toHaveLength(1);

  await writeFile(join(dir, "pending", "helper.ts"), 'export const id = "arrived";\n');
  expect((await loader.directory(dir)).loaded[0]?.plugin.id).toBe("arrived");
  loader.close();
});

test("keeps a linked package's cached module instead of evaluating it again", async () => {
  const dir = await tempFolder();
  const linked = await tempFolder();
  const evaluations = join(linked, "evaluations.txt");
  await writeFile(
    join(linked, "package.json"),
    '{ "name": "linked", "type": "module", "exports": "./index.js" }',
  );
  await writeFile(
    join(linked, "index.js"),
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(evaluations)}, "evaluated\\n");\nexport const shared = {};\n`,
  );
  await mkdir(join(dir, "node_modules"));
  await symlink(linked, join(dir, "node_modules", "linked"), "dir");
  await writeFile(
    join(dir, "uses.mjs"),
    'import { shared } from "linked";\nexport default { id: "uses", shared };\n',
  );
  await import(join(linked, "index.js"));
  const importPlugin = bunPluginImport();
  const first = await importPlugin(join(dir, "uses.mjs"));
  const second = await importPlugin(join(dir, "uses.mjs"));

  expect([first.result.kind, second.result.kind]).toEqual(["module", "module"]);
  expect([...first.files.keys()]).toEqual([join(dir, "uses.mjs")]);
  expect(await readFile(evaluations, "utf8")).toBe("evaluated\n");
});
