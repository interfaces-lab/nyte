import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, test } from "vitest";
import { discoverMentionFiles } from "../src/mention-files.ts";

const roots: string[] = [];

function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nyte-mentions-")));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("discoverMentionFiles", () => {
  test("lists files and folders with workspace-relative display paths and file URLs", async () => {
    const root = scratch();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "");
    writeFileSync(join(root, "README.md"), "");

    const files = await discoverMentionFiles(root);

    assert.deepEqual(
      files.map((file) => [file.displayPath, file.label]),
      [
        ["README.md", "README.md"],
        ["src/", "src/"],
        ["src/index.ts", "index.ts"],
      ],
    );
    const folder = files.find((file) => file.label === "src/");
    assert.equal(folder?.path, join(root, "src") + sep);
    assert.equal(folder?.url, pathToFileURL(join(root, "src")).href);
    const index = files.find((file) => file.label === "index.ts");
    assert.equal(index?.url, pathToFileURL(join(root, "src", "index.ts")).href);
  });

  test("skips generated trees", async () => {
    const root = scratch();
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(root, "node_modules", "dep", "index.js"), "");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "app.ts"), "");

    const files = await discoverMentionFiles(root);

    assert.deepEqual(
      files.map((file) => file.displayPath),
      ["app.ts"],
    );
  });
});
