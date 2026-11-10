import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { memoryStore } from "@nyte-ai/core/store";
import { afterEach, describe, expect, it } from "vitest";
import { openHost } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-skills-")));
  folders.push(made);

  return made;
}

async function put(root: string, path: string, body: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), body);
}

async function catalogSkills(home: string) {
  const host = await openHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home,
  });

  try {
    const [workspace] = await host.workspaces.list();

    if (workspace === undefined) throw new Error("No workspace.");

    return (await host.workspace(workspace.id).catalog()).skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location.slice(home.length),
    }));
  } finally {
    await host.close();
  }
}

describe("skill discovery", () => {
  it("reads folded, literal, quoted and malformed descriptions", async () => {
    const home = await folder();

    await put(
      home,
      ".agents/skills/clipped/SKILL.md",
      '---\nname: clipped\ndescription: >\n  Use when: a line holds "quotes",\n  it\'s `code` and wraps.\npaths:\n  - "packages/*/src/**/*.ts"\n---\n',
    );
    await put(
      home,
      ".agents/skills/folded/SKILL.md",
      "---\nname: folded\ndescription: >-\n  One line\n  continued.\n---\n",
    );
    await put(
      home,
      ".agents/skills/literal/SKILL.md",
      "---\nname: literal\ndescription: |\n  First.\n  Second.\n---\n",
    );
    await put(
      home,
      ".agents/skills/quoted/SKILL.md",
      "---\nname: quoted\ndescription: 'Quoted: kept.'\n---\n",
    );
    await put(
      home,
      ".agents/skills/malformed/SKILL.md",
      "---\nname: malformed\ndescription: Use when: the YAML is invalid.\n---\n",
    );

    expect(await catalogSkills(home)).toEqual([
      {
        name: "clipped",
        description: 'Use when: a line holds "quotes", it\'s `code` and wraps.',
        location: "/.agents/skills/clipped/SKILL.md",
      },
      {
        name: "folded",
        description: "One line continued.",
        location: "/.agents/skills/folded/SKILL.md",
      },
      {
        name: "literal",
        description: "First.\nSecond.",
        location: "/.agents/skills/literal/SKILL.md",
      },
      {
        name: "malformed",
        description: "Use when: the YAML is invalid.",
        location: "/.agents/skills/malformed/SKILL.md",
      },
      {
        name: "quoted",
        description: "Quoted: kept.",
        location: "/.agents/skills/quoted/SKILL.md",
      },
    ]);
  });

  it("loads linked skill directories once per target, skipping broken, file and cyclic links", async () => {
    const home = await folder();
    const shared = await folder();
    const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`;

    await put(home, ".agents/skills/plain/SKILL.md", skill("plain"));
    await put(shared, "linked/SKILL.md", skill("linked"));
    await put(shared, "linked/node_modules/deep/SKILL.md", skill("deep"));
    await symlink(join(shared, "linked"), join(shared, "linked/node_modules/deep/loop"));
    await put(shared, "notes.md", skill("notes"));
    await put(home, "kept/unnamed/SKILL.md", "---\ndescription: No name.\n---\n");

    await mkdir(join(home, ".nyte/skills"), { recursive: true });
    await symlink(join(shared, "linked"), join(home, ".nyte/skills/first"));
    await symlink(join(shared, "linked"), join(home, ".agents/skills/second"));
    await symlink("plain", join(home, ".agents/skills/plain-alias"));
    await symlink("../../kept/unnamed", join(home, ".agents/skills/relative"));
    await symlink("relative", join(home, ".agents/skills/zz-chain"));
    await symlink(join(shared, "missing"), join(home, ".agents/skills/broken"));
    await symlink(join(shared, "notes.md"), join(home, ".agents/skills/file"));
    await symlink("loop", join(home, ".agents/skills/loop"));
    await symlink("ping", join(home, ".agents/skills/pong"));
    await symlink("pong", join(home, ".agents/skills/ping"));

    expect(await catalogSkills(home)).toEqual([
      {
        name: "linked",
        description: "The linked skill.",
        location: "/.nyte/skills/first/SKILL.md",
      },
      {
        name: "plain",
        description: "The plain skill.",
        location: "/.agents/skills/plain/SKILL.md",
      },
      {
        name: "relative",
        description: "No name.",
        location: "/.agents/skills/relative/SKILL.md",
      },
    ]);
  });
});
