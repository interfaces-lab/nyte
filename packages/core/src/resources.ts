import { standard } from "@nyte-ai/schema";
import type { SessionId, ValidationIssue, WorkspaceId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { filesOf, readWorkspace } from "./environment.ts";
import type { Resources } from "./environment.ts";
import { SdkError } from "./error.ts";
import type { FilesApi } from "./files.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import { readKv } from "./plugin-runtime.ts";
import { kvRef } from "./refs.ts";
import { requireSession } from "./session-state.ts";

type Skill = Resources["skills"][number];

type Prompt = Resources["prompts"][number];

type ContextFile = Resources["contextFiles"][number];

const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"];

const SKILL_DIRECTORIES = [".nyte/skills", ".agents/skills"];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const scanIssues = new WeakMap<Resources, readonly ValidationIssue[]>();

/** Resolves what core scanned for a session through `FilesApi` only, cached until `invalidateResources` drops its workspace or the session moves. A failure to attach the session's environment or the home's rejects, never answering "no resources" (D 13). */
export async function scanResources(kernel: Kernel, session: SessionId): Promise<Resources> {
  const workspace = (await requireSession(kernel, session)).record.workspace;
  const table = kernel.workspaceState.scans;
  const cached = table.get(session);

  if (cached !== undefined && cached.workspace === workspace) return cached.resources;
  const entry = { workspace, resources: scan(kernel, session, workspace) };
  table.set(session, entry);

  entry.resources.catch(() => {
    if (table.get(session) === entry) table.delete(session);
  });

  return entry.resources;
}

/** Drops the cached resources of every session on a workspace. */
export function invalidateResources(kernel: Kernel, workspace: WorkspaceId): void {
  const table = kernel.workspaceState.scans;

  for (const [session, cached] of table) if (cached.workspace === workspace) table.delete(session);
}

/** Returns a scan's warnings: one per skill dropped as a duplicate name. */
export function resourceIssues(resources: Resources): readonly ValidationIssue[] {
  return scanIssues.get(resources) ?? [];
}

/** Contributes what core scanned for a session (decision 13): the `project-context` and `skills` prompt sections, the skills themselves, the scan's duplicate-skill warnings, and the host setting `skills.paths`. A session with no scan here (inactive) contributes only the setting. */
export const resourcesPlugin: Plugin<"core"> = {
  id: "resources",
  contribute: {
    settings: [
      {
        id: "skills.paths",
        label: "Skill paths",
        schema: standard(Type.Array(Type.String())),
        default: [],
        scope: "host",
      },
    ],
  },
  activate(api) {
    const inputs = inputsOf(api);

    if (inputs === null) return;

    for (const issue of resourceIssues(inputs)) api.report(issue);

    if (inputs.contextFiles.length > 0)
      api.contribute.prompt.add({
        id: "project-context",
        order: 10,
        text: [
          "Instructions from the user and the project, in order; later files are more specific:",
          ...inputs.contextFiles.map((file) => `# ${file.path}\n\n${file.content.trim()}`),
        ].join("\n\n"),
      });

    if (inputs.skills.length > 0)
      api.contribute.prompt.add({
        id: "skills",
        order: 90,
        text: [
          "Skills: read a skill's file when its description matches the task.",
          ...inputs.skills.map(
            (skill) =>
              `- ${skill.name}: ${skill.description === "" ? "(no description)" : skill.description} (${skill.scope === "user" ? `~/${skill.location}` : skill.location})`,
          ),
        ].join("\n"),
      });

    api.contribute.skills.add((draft) => {
      for (const skill of inputs.skills)
        draft.set(skill.name, {
          name: skill.name,
          description: skill.description,
          location: skill.location,
          load: () => loadSkill(inputs, skill),
        });
    });
  },
};

/** Returns the plugin's scanned resources, or null when the session is not attached here. */
function inputsOf(api: PluginApi<"core">): Resources | null {
  try {
    return api.inputs;
  } catch {
    return null;
  }
}

/** Reads a skill's file through the files of its scope. */
async function loadSkill(inputs: Resources, skill: Resources["skills"][number]): Promise<string> {
  const files = skill.scope === "project" ? inputs.project : inputs.user;

  if (files === null)
    throw new SdkError("unavailable", `The ${skill.scope} files of skill ${skill.name} are gone.`);
  const document = await files.read(skill.location);

  if (document.kind !== "text")
    throw new SdkError("unknown", `Skill ${skill.name} has no text at ${skill.location}.`);

  return document.contents;
}

async function scan(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
): Promise<Resources> {
  const record = await readWorkspace(kernel, workspace);
  const user = await userFiles(kernel);

  const env =
    record?.projectResources === true &&
    filesOf(kernel.environments.provider(record.target.kind)) === "available"
      ? await kernel.env(session)
      : null;

  const project = env?.files ?? null;
  const root = env !== null && env.cwd.startsWith("/") ? env.cwd : null;
  const home = kernel.home;

  const [projectSkills, userSkills, pathSkills] = await Promise.all([
    project === null ? [] : skillsIn(project, SKILL_DIRECTORIES, "project"),
    user === null ? [] : skillsIn(user, SKILL_DIRECTORIES, "user"),
    user === null ? [] : skillsAt(user, await skillPaths(kernel)),
  ]);

  const { kept: skills, dropped } = byName([...projectSkills, ...userSkills, ...pathSkills]);

  const issues = dropped.map(({ item, over }): ValidationIssue => ({
    severity: "warning",
    path: ["skills", item.name],
    message: `The ${item.scope} skill ${item.name} at ${item.location} is shadowed by the ${over.scope} one at ${over.location}.`,
    source: { plugin: "resources" },
  }));

  const contextFiles: ContextFile[] = [];

  if (user !== null && home !== null) {
    const content = await readText(user, ".nyte/AGENTS.md");

    if (content !== null)
      contextFiles.push({ path: join(home, ".nyte/AGENTS.md"), scope: "user", content });
  }

  if (project !== null && root !== null) contextFiles.push(...(await ancestorFiles(project, root)));

  if (project !== null) {
    const found = await firstContext(project, (name) => name);

    if (found !== null)
      contextFiles.push({
        path: root === null ? found.path : join(root, found.path),
        scope: "project",
        content: found.content,
      });
  }

  const [userSystem, userAppend, projectSystem, projectAppend] = await Promise.all([
    user === null ? null : readText(user, ".nyte/SYSTEM.md"),
    user === null ? null : readText(user, ".nyte/APPEND_SYSTEM.md"),
    project === null ? null : readText(project, ".nyte/SYSTEM.md"),
    project === null ? null : readText(project, ".nyte/APPEND_SYSTEM.md"),
  ]);

  const [projectPrompts, userPrompts] = await Promise.all([
    project === null ? [] : promptsIn(project, "project"),
    user === null ? [] : promptsIn(user, "user"),
  ]);

  const resources: Resources = {
    user,
    project,
    skills,
    contextFiles,
    prompt: {
      system: projectSystem ?? userSystem,
      append: projectAppend ?? userAppend,
      scope:
        projectSystem !== null || projectAppend !== null
          ? "project"
          : userSystem !== null || userAppend !== null
            ? "user"
            : null,
    },
    prompts: byName([...projectPrompts, ...userPrompts]).kept,
  };

  scanIssues.set(resources, issues);
  const api = kernel.runtimes().get(session)?.api("resources");

  for (const issue of issues) api?.report(issue);

  return resources;
}

/** Resolves the host home's files through the `"local"` provider, attached once per kernel; null without a home or a `"local"` provider. */
function userFiles(kernel: Kernel): Promise<FilesApi | null> {
  const state = kernel.workspaceState;

  if (state.home !== null) return state.home;
  const home = kernel.home;
  const local = home === null ? undefined : kernel.environments.provider("local");

  if (home === null || local === undefined) return Promise.resolve(null);
  const attached = local.attach({ kind: "local", path: home }).then((env) => env.files);
  state.home = attached;

  attached.catch(() => {
    if (state.home === attached) state.home = null;
  });

  return attached;
}

/** Returns the host setting `skills.paths`, or none when it is unset or not a list of strings. */
async function skillPaths(kernel: Kernel): Promise<readonly string[]> {
  const value = await readKv(kernel, kvRef("host", "settings", "skills.paths"));

  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" ? [entry] : []))
    : [];
}

/** Returns the skills under each directory: every `<dir>/<name>/SKILL.md`. */
async function skillsIn(
  files: FilesApi,
  directories: readonly string[],
  scope: Skill["scope"],
): Promise<readonly Skill[]> {
  const found: Skill[] = [];

  for (const directory of directories) {
    for (const name of await childrenOf(files, directory, "directory")) {
      const location = `${directory}/${name}/SKILL.md`;
      const content = await readText(files, location);

      if (content !== null) found.push(skillOf(content, name, location, scope));
    }
  }

  return found;
}

/** Returns the skills the extra paths name: a `.md` file is one skill, anything else a directory scanned like `.nyte/skills`. */
async function skillsAt(files: FilesApi, paths: readonly string[]): Promise<readonly Skill[]> {
  const found: Skill[] = [];

  for (const raw of paths) {
    const path = raw.startsWith("~/") ? raw.slice(2) : raw;

    if (!path.endsWith(".md")) {
      found.push(...(await skillsIn(files, [path.replace(/\/+$/, "")], "path")));

      continue;
    }

    const content = await readText(files, path);
    const name = path.slice(path.lastIndexOf("/") + 1, -".md".length);

    if (content !== null) found.push(skillOf(content, name, path, "path"));
  }

  return found;
}

/** Returns the prompt templates directly under `.nyte/prompts`. */
async function promptsIn(files: FilesApi, scope: Prompt["scope"]): Promise<readonly Prompt[]> {
  const names = await childrenOf(files, ".nyte/prompts", "file");

  return names.flatMap((name) =>
    name.endsWith(".md")
      ? [{ name: name.slice(0, -".md".length), location: `.nyte/prompts/${name}`, scope }]
      : [],
  );
}

/** Returns a skill from its file: frontmatter `name` (else `fallback`) and `description`. */
function skillOf(
  content: string,
  fallback: string,
  location: string,
  scope: Skill["scope"],
): Skill {
  const fields = frontmatter(content);

  return {
    name: fields.get("name") ?? fallback,
    location,
    scope,
    description: fields.get("description") ?? "",
  };
}

/** Returns the ancestor context files of a workspace root, root first, read through the workspace's own files; none when those files reject a path. */
async function ancestorFiles(files: FilesApi, root: string): Promise<readonly ContextFile[]> {
  const found: ContextFile[] = [];

  try {
    for (const directory of ancestorsOf(root)) {
      for (const name of CONTEXT_NAMES) {
        const path = join(directory, name);
        const document = await files.read(path);

        if (document.kind !== "text") continue;
        found.push({ path, scope: "ancestor", content: document.contents });

        break;
      }
    }
  } catch {
    return [];
  }

  return found;
}

/** Returns the first of `AGENTS.override.md`, `AGENTS.md` and `CLAUDE.md` at the paths `at` gives. */
async function firstContext(
  files: FilesApi,
  at: (name: string) => string,
): Promise<{ readonly path: string; readonly content: string } | null> {
  for (const name of CONTEXT_NAMES) {
    const path = at(name);
    const content = await readText(files, path);

    if (content !== null) return { path, content };
  }

  return null;
}

/** Returns the names of a directory's direct children of one kind. */
async function childrenOf(
  files: FilesApi,
  directory: string,
  kind: "file" | "directory",
): Promise<readonly string[]> {
  const names = new Set<string>();

  for await (const frame of files.scan({ directory })) {
    if (frame.kind !== "entries") continue;

    for (const entry of frame.entries) {
      const relative = entry.path.startsWith(`${directory}/`)
        ? entry.path.slice(directory.length + 1)
        : entry.path;

      if (entry.kind === kind && relative !== "" && !relative.includes("/")) names.add(relative);
    }
  }

  return [...names].sort();
}

/** Returns a file's text, or null when it is missing or not text; a failed read rejects (D 13). */
async function readText(files: FilesApi, path: string): Promise<string | null> {
  const document = await files.read(path);

  return document.kind === "text" ? document.contents : null;
}

/** Returns the `key: value` lines of a leading `---` block, values unquoted. */
function frontmatter(content: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const block = FRONTMATTER.exec(content)?.[1];

  for (const line of block?.split(/\r?\n/) ?? []) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const key = pair?.[1];
    const value = pair?.[2]?.trim();

    if (key !== undefined && value !== undefined && value !== "")
      fields.set(key, value.replace(/^(["'])(.*)\1$/, "$2"));
  }

  return fields;
}

/** Returns the first item per name, sorted by name, and each later one with the item it lost to. */
function byName<T extends { readonly name: string }>(
  items: readonly T[],
): {
  readonly kept: readonly T[];
  readonly dropped: readonly { readonly item: T; readonly over: T }[];
} {
  const kept = new Map<string, T>();
  const dropped: { readonly item: T; readonly over: T }[] = [];

  for (const item of items) {
    const over = kept.get(item.name);

    if (over === undefined) kept.set(item.name, item);
    else dropped.push({ item, over });
  }

  return {
    kept: [...kept.values()].sort((left, right) => (left.name < right.name ? -1 : 1)),
    dropped,
  };
}

/** Returns the directories above an absolute path, root first: `/`, `/a`, … up to its parent. */
function ancestorsOf(root: string): readonly string[] {
  const parts = root.split("/").filter((part) => part !== "");

  return parts.map((_part, index) => `/${parts.slice(0, index).join("/")}`);
}

function join(directory: string, name: string): string {
  return directory.endsWith("/") ? `${directory}${name}` : `${directory}/${name}`;
}
