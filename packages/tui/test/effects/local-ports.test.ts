import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { resolveMention } from "../../src/effects/local-ports.ts";

const root = await mkdtemp(join(tmpdir(), "nyte-mention-"));

const cwd = join(root, "work");

await mkdir(join(cwd, "src"), { recursive: true });

await mkdir(join(root, "notes"));

await writeFile(join(cwd, "src", "app.ts"), "export {};\n");

afterAll(() => rm(root, { recursive: true, force: true }));

test("an @ path names a file or a folder, relative to the workspace", async () => {
  expect(await resolveMention("./src/app.ts", cwd)).toEqual({
    path: join(cwd, "src", "app.ts"),
    display: "src/app.ts",
    label: "app.ts",
  });
  expect(await resolveMention("../notes", cwd)).toEqual({
    path: `${join(root, "notes")}/`,
    display: "../notes/",
    label: "notes/",
  });
  expect(await resolveMention(`${cwd}/`, cwd)).toEqual({
    path: `${cwd}/`,
    display: "./",
    label: "work/",
  });
});

test("a path that names nothing resolves to null", async () => {
  expect(await resolveMention("./missing.ts", cwd)).toBeNull();
});
