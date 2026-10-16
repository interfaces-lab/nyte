import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { folderIdentity, localProvider } from "../src/index.ts";

const HEX = /^[0-9a-f]{64}$/;

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-provider-")));
  folders.push(made);

  return made;
}

describe("localProvider", () => {
  it("inspects a folder: its identity, availability and project sources in order", async () => {
    const root = await folder();

    for (const [path, body] of [
      ["CLAUDE.md", "claude"],
      ["AGENTS.md", "agents"],
      [".nyte/APPEND_SYSTEM.md", "append"],
      [".nyte/mcp.json", "{}"],
      [".nyte/prompts/fix.md", "Fix it."],
      [".nyte/prompts/draft.txt", "not a prompt"],
      [".agents/skills/lint/SKILL.md", "# Lint"],
      [".nyte/skills/review/SKILL.md", "# Review"],
      [".nyte/skills/bare/notes.md", "no skill"],
      [".nyte/plugins/notes.txt", "not a plugin"],
      [".nyte/plugins/empty/readme.md", "no index"],
      [".nyte/plugins/dir/index.js", 'export default { id: "dir" };\n'],
      [".nyte/plugins/b.ts", 'export default { id: "b" };\n'],
      [".nyte/plugins/a.mjs", 'export default { id: "a" };\n'],
    ] as const) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), body);
    }

    const provider = localProvider({ home: await folder() });
    const inspected = await provider.inspect({ kind: "local", path: root });

    expect(provider.kind).toBe("local");
    expect(inspected).toEqual({
      identity: await folderIdentity(root),
      availability: { kind: "available" },
      projectSources: [
        ".nyte/plugins/a.mjs",
        ".nyte/plugins/b.ts",
        ".nyte/plugins/dir/index.js",
        ".nyte/skills/review/SKILL.md",
        ".agents/skills/lint/SKILL.md",
        ".nyte/prompts/fix.md",
        ".nyte/APPEND_SYSTEM.md",
        ".nyte/mcp.json",
      ],
    });
    expect(inspected.identity).toMatch(HEX);
    expect(await provider.inspect({ kind: "local", path: join(root, "missing") })).toEqual({
      identity: expect.stringMatching(HEX),
      availability: { kind: "unavailable", reason: "unreachable" },
      projectSources: [],
    });
    expect(await provider.inspect({ kind: "sandbox", locator: "box" })).toEqual({
      identity: expect.stringMatching(HEX),
      availability: { kind: "unavailable", reason: "unsupported" },
      projectSources: [],
    });
  });

  it("attaches a folder at its real path under its identity, which a rename keeps", async () => {
    const parent = await folder();
    const root = join(parent, "project");
    await mkdir(root);
    await writeFile(join(root, "a.txt"), "hello\n");
    await symlink(root, join(parent, "link"));
    const provider = localProvider({ home: await folder() });
    const { identity } = await provider.inspect({ kind: "local", path: root });
    const env = await provider.attach({ kind: "local", path: join(parent, "link") });

    expect([env.identity, env.cwd]).toEqual([identity, root]);
    expect(await env.files.read("a.txt")).toMatchObject({ kind: "text", contents: "hello\n" });
    await env.close();

    const moved = join(parent, "renamed");
    await rename(root, moved);
    expect((await provider.inspect({ kind: "local", path: moved })).identity).toBe(identity);
    const reattached = await provider.attach({ kind: "local", path: moved });

    expect([reattached.identity, reattached.cwd]).toEqual([identity, moved]);
    await reattached.close();
    await expect(provider.attach({ kind: "local", path: root })).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(provider.attach({ kind: "sandbox", locator: "box" })).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(provider.destroy?.({ kind: "local", path: moved })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
