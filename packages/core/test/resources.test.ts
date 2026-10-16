import { readFileSync } from "node:fs";
import { asId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { createHost } from "../src/api/connection.ts";
import { resourceIssues, resourcesPlugin, scanResources } from "../src/extend/resources.ts";
import { memoryStore } from "../src/store.ts";
import type { Plugin } from "../src/index.ts";
import { createDisk, fakeProvider, kernelOver, world } from "./fake-env.ts";
import { env, until } from "./harness.ts";

function seeded() {
  const disk = createDisk();

  const skill = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: "${description}"\n---\n\nUse ${name}.\n`;

  disk.put("/home/ada/.nyte/skills/review/SKILL.md", skill("review", "Reviews diffs."));
  disk.put("/home/ada/.nyte/skills/shared/SKILL.md", skill("shared", "The user's."));
  disk.put("/home/ada/.agents/skills/lint/SKILL.md", "No frontmatter.\n");
  disk.put("/home/ada/extra/solo.md", skill("solo", "From a path."));
  disk.put("/home/ada/.nyte/AGENTS.md", "User rules.\n");
  disk.put("/home/ada/.nyte/SYSTEM.md", "User system.\n");
  disk.put("/home/ada/.nyte/prompts/fix.md", "Fix it (user).\n");
  disk.put("/AGENTS.md", "Root rules.\n");
  disk.put("/work/CLAUDE.md", "Work claude.\n");
  disk.put("/work/AGENTS.md", "Work agents.\n");
  disk.put("/work/project/AGENTS.md", "Project agents.\n");
  disk.put("/work/project/AGENTS.override.md", "Project override.\n");
  disk.put("/work/project/.nyte/skills/shared/SKILL.md", skill("shared", "The project's."));
  disk.put("/work/project/.nyte/APPEND_SYSTEM.md", "Project append.\n");
  disk.put("/work/project/.nyte/prompts/fix.md", "Fix it (project).\n");
  disk.put("/work/project/.nyte/prompts/ship.md", "Ship it.\n");

  return disk;
}

describe("resources", () => {
  it("scans user, ancestor, project and path sources: project wins, ancestors root first, prompt precedence", async () => {
    const { kernel, host, workspace } = await world({
      disk: seeded(),
      home: "/home/ada",
      plugins: [resourcesPlugin],
    });

    expect(await host.settings.apply("skills.paths", ["~/extra/solo.md"])).toMatchObject({
      kind: "applied",
    });

    const session = await host.sessions.create({ workspace });
    const resources = await scanResources(kernel, session.id);

    expect(resources.user).not.toBeNull();
    expect(resources.project).not.toBeNull();
    expect(resources.skills).toEqual([
      {
        name: "lint",
        location: "/home/ada/.agents/skills/lint/SKILL.md",
        scope: "user",
        description: "",
      },
      {
        name: "review",
        location: "/home/ada/.nyte/skills/review/SKILL.md",
        scope: "user",
        description: "Reviews diffs.",
      },
      {
        name: "shared",
        location: ".nyte/skills/shared/SKILL.md",
        scope: "project",
        description: "The project's.",
      },
      {
        name: "solo",
        location: "/home/ada/extra/solo.md",
        scope: "path",
        description: "From a path.",
      },
    ]);
    expect(resourceIssues(resources)).toEqual([
      expect.objectContaining({ severity: "warning", path: ["skills", "shared"] }),
    ]);
    expect(resources.contextFiles).toEqual([
      { path: "/home/ada/.nyte/AGENTS.md", scope: "user", content: "User rules.\n" },
      { path: "/AGENTS.md", scope: "ancestor", content: "Root rules.\n" },
      { path: "/work/AGENTS.md", scope: "ancestor", content: "Work agents.\n" },
      {
        path: "/work/project/AGENTS.override.md",
        scope: "project",
        content: "Project override.\n",
      },
    ]);
    expect(resources.prompt).toEqual({
      system: "User system.\n",
      append: "Project append.\n",
      scope: "project",
    });
    expect(resources.prompts).toEqual([
      { name: "fix", location: ".nyte/prompts/fix.md", scope: "project" },
      { name: "ship", location: ".nyte/prompts/ship.md", scope: "project" },
    ]);
    expect(await scanResources(kernel, session.id)).toBe(resources);
  });

  it("rejects a scan while the session's environment does not attach, never answering no resources (D 13)", async () => {
    const { kernel, host, provider, workspace } = await world({
      disk: seeded(),
      home: "/home/ada",
    });
    provider.failure = "Offline.";
    const session = await host.sessions.create({ workspace });

    await expect(scanResources(kernel, session.id)).rejects.toThrow("Offline.");
  });

  it("rejects a scan whose resource file read fails, never caching a null prompt (audit D4-D5 #5, resource-file-read-failure)", async () => {
    const { kernel, host, disk, provider, workspace } = await world();
    disk.put("/work/project/.nyte/SYSTEM.md", "MUST REMAIN");
    const attach = provider.attach.bind(provider);
    let failing = true;

    provider.attach = async (target) => {
      const attached = await attach(target);

      return {
        ...attached,
        files: {
          ...attached.files,
          read: async (path) => {
            if (failing && path === ".nyte/SYSTEM.md") throw new Error("Transient read failure.");

            return attached.files.read(path);
          },
        },
      };
    };

    const session = await host.sessions.create({ workspace });

    await expect(scanResources(kernel, session.id)).rejects.toThrow("Transient read failure.");
    failing = false;
    expect((await scanResources(kernel, session.id)).prompt.system).toBe("MUST REMAIN");
  });

  it("lists a SKILL.md added mid-session without a reload, and stops watching once the session's scan is dropped", async () => {
    const disk = seeded();
    const { kernel, host, workspace } = await world({
      disk,
      home: "/home/ada",
      plugins: [resourcesPlugin],
    });

    const session = await host.sessions.create({ workspace });
    await kernel.plugins.runtime(session.id).ready;
    const names = (): readonly string[] =>
      kernel.sessions.catalog(session.id).skills.map((skill) => skill.name);

    expect(names()).not.toContain("fresh");
    await until(() => (disk.watchers.size === 2 ? true : undefined));

    disk.put(
      "/work/project/.agents/skills/fresh/SKILL.md",
      '---\nname: fresh\ndescription: "Added later."\n---\n',
    );
    await until(() => (names().includes("fresh") ? true : undefined));
    disk.put("/home/ada/.nyte/skills/late/SKILL.md", "---\nname: late\n---\n");
    await until(() => (names().includes("late") ? true : undefined));

    disk.put("/work/project/src/app.ts", "unrelated\n");
    expect(disk.watchers.size).toBe(2);
    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(disk.watchers.size).toBe(0);
  });

  it("keeps scans, the home's files and file batches on the kernel's state, in no module table (audit D4-D5 #6, D6 #2)", async () => {
    const { kernel, host, workspace } = await world({ disk: seeded(), home: "/home/ada" });
    const session = await host.sessions.create({ workspace });
    const files = await host.workspace(workspace).files();
    assert(files.kind === "available");
    const receipt = await files.api.batch().put({ path: "a.md", contents: "a" }).apply();

    await scanResources(kernel, session.id);
    expect(kernel.workspaceState.scans.has(session.id)).toBe(true);
    expect(kernel.workspaceState.home).not.toBeNull();
    expect(kernel.workspaceState.held.get(receipt.id)?.receipt).toBe(receipt);

    for (const file of [
      "env/workspaces.ts",
      "extend/resources.ts",
      "engine/batches.ts",
      "env/environment.ts",
    ])
      expect(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).not.toMatch(
        /new WeakMap<Kernel/,
      );
  });

  it("gives a chat-only workspace, whose provider serves no files, no resources and a successful activation (§59)", async () => {
    const chatOnly: Plugin<"core"> = {
      id: "chat-only",
      environment: {
        kind: "chat-only",
        inspect: async () => ({
          identity: asId("chat-only"),
          availability: { kind: "available" },
          projectSources: [],
        }),
        attach: async () => ({ ...env, identity: asId("chat-only") }),
      },
    };

    const { kernel, host } = await world({ plugins: [chatOnly] });
    const added = await host.workspaces.add({ kind: "chat-only", locator: null });
    assert(added.kind === "added");
    const session = await host.sessions.create({ workspace: added.workspace });
    await kernel.plugins.runtime(session.id).ready;

    expect((await session.info()).activation).toEqual({ kind: "active" });
    expect(await scanResources(kernel, session.id)).toMatchObject({
      project: null,
      skills: [],
      contextFiles: [],
      prompt: { system: null, append: null, scope: null },
    });
  });

  it("hides project skills, prompts and system files but keeps context files when projectResources is false", async () => {
    const { kernel, host, workspace } = await world({ disk: seeded(), home: "/home/ada" });
    const session = await host.sessions.create({ workspace });
    const before = await scanResources(kernel, session.id);

    expect(before.project).not.toBeNull();
    expect(await host.workspace(workspace).update({ projectResources: false })).toEqual({
      kind: "updated",
    });

    const hidden = await scanResources(kernel, session.id);

    expect(hidden).not.toBe(before);
    expect(hidden.project).toBeNull();
    expect(hidden.skills.map((skill) => [skill.name, skill.scope])).toEqual([
      ["lint", "user"],
      ["review", "user"],
      ["shared", "user"],
    ]);
    expect(resourceIssues(hidden)).toEqual([]);
    expect(hidden.contextFiles.map((file) => [file.scope, file.path])).toEqual([
      ["user", "/home/ada/.nyte/AGENTS.md"],
      ["ancestor", "/AGENTS.md"],
      ["ancestor", "/work/AGENTS.md"],
      ["project", "/work/project/AGENTS.override.md"],
    ]);
    expect(hidden.prompt).toEqual({ system: "User system.\n", append: null, scope: "user" });
    expect(hidden.prompts).toEqual([
      { name: "fix", location: ".nyte/prompts/fix.md", scope: "user" },
    ]);
  });

  it("reads ancestors through the workspace's own files, not the host's, and none from a sandbox confined to its root", async () => {
    const disk = seeded();
    const { kernel, host, workspace } = await world({ disk });
    const session = await host.sessions.create({ workspace });
    const resources = await scanResources(kernel, session.id);

    expect(resources.user).toBeNull();
    expect(resources.skills.map((skill) => skill.scope)).toEqual(["project"]);
    expect(resources.contextFiles.map((file) => [file.scope, file.path])).toEqual([
      ["ancestor", "/AGENTS.md"],
      ["ancestor", "/work/AGENTS.md"],
      ["project", "/work/project/AGENTS.override.md"],
    ]);

    disk.put("/remote/AGENTS.md", "Sandbox rules.\n");
    const sandbox = fakeProvider(disk, { kind: "sandbox", confined: true });
    const remote = kernelOver(await memoryStore().open(), sandbox, { home: "/home/ada" });
    const remoteHost = createHost(remote, { credential: { kind: "token", token: "x" } });
    const added = await remoteHost.workspaces.add(
      { kind: "sandbox", locator: "box" },
      { projectResources: true },
    );
    assert(added.kind === "added");
    const boxed = await remoteHost.sessions.create({ workspace: added.workspace });
    const scanned = await scanResources(remote, boxed.id);

    expect(scanned.user).toBeNull();
    expect(scanned.contextFiles).toEqual([
      { path: "/remote/AGENTS.md", scope: "project", content: "Sandbox rules.\n" },
    ]);
  });

  it("contributes the context and skills sections, loadable skills, and the shadowed skill as an issue", async () => {
    const { kernel, host, workspace } = await world({
      disk: seeded(),
      home: "/home/ada",
      plugins: [
        resourcesPlugin,
        {
          id: "deploy-kit",
          contribute: {
            skills: [
              { name: "deploy", description: "Ships a release.", location: "/kits/deploy.md" },
            ],
          },
        },
      ],
    });

    const session = await host.sessions.create({ workspace });
    const { registries } = kernel.plugins.runtime(session.id);
    const sections = registries.prompt.list();
    const context = sections.find((section) => section.id === "project-context");
    const skills = sections.find((section) => section.id === "skills");

    assert(context !== undefined && skills !== undefined);
    expect([context.order, skills.order]).toEqual([10, 90]);
    expect(context.text).toMatch(/# \/home\/ada\/\.nyte\/AGENTS\.md[\s\S]*# \/AGENTS\.md/u);
    expect(context.text).toContain("# /work/project/AGENTS.override.md\n\nProject override.");
    expect(skills.text).toContain(
      "- review: Reviews diffs. (/home/ada/.nyte/skills/review/SKILL.md)",
    );
    expect(skills.text).toContain("- shared: The project's. (.nyte/skills/shared/SKILL.md)");
    expect(skills.text).toContain("- deploy: Ships a release. (/kits/deploy.md)");

    const contributed = registries.skills.list();
    const shared = contributed.find((skill) => skill.name === "shared");
    const review = contributed.find((skill) => skill.name === "review");

    assert(shared !== undefined && review !== undefined);
    expect([shared.location, review.location]).toEqual([
      ".nyte/skills/shared/SKILL.md",
      "/home/ada/.nyte/skills/review/SKILL.md",
    ]);
    expect(kernel.host.current().plugins.find((row) => row.id === "resources")?.issues).toEqual([
      expect.objectContaining({ path: ["skills", "shared"], severity: "warning" }),
    ]);
  });
});
