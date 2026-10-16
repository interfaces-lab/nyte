import { standard } from "@nyte-ai/schema";
import type { SessionId, ValidationIssue, WorkspaceId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { classifyFileSupport, readWorkspace, workspaceRecords } from "./environment.ts";
import type { Resources } from "./environment.ts";
import { SdkError } from "./error.ts";
import type { FilesApi } from "./files.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import type { WorkspaceRecord } from "./records.ts";
import { readKv } from "./plugin-runtime.ts";
import { kvRef } from "./refs.ts";
import { requireSession } from "./session-state.ts";

type Skill = Resources["skills"][number];

type Prompt = Resources["prompts"][number];

type ContextFile = Resources["contextFiles"][number];

const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"];

const SKILL_DIRECTORIES = [".nyte/skills", ".agents/skills"];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export const SKILL_PATHS = "skills.paths";

export const WORKSPACE_TRUST = "workspaceTrust";

const scanIssues = new WeakMap<Resources, readonly ValidationIssue[]>();

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

export function invalidateResources(kernel: Kernel, workspace: WorkspaceId): void {
  const table = kernel.workspaceState.scans;

  for (const [session, cached] of table) if (cached.workspace === workspace) table.delete(session);
}

export function resourceIssues(resources: Resources): readonly ValidationIssue[] {
  return scanIssues.get(resources) ?? [];
}

export const resourcesPlugin: Plugin<"core"> = {
  id: "resources",
  contribute: {
    settings: [
      {
        id: SKILL_PATHS,
        label: "Skill paths",
        schema: standard(Type.Array(Type.String())),
        default: [],
        scope: "host",
      },
      {
        id: WORKSPACE_TRUST,
        label: "Project trust",
        schema: standard(
          Type.Union([Type.Literal("ask"), Type.Literal("always"), Type.Literal("never")]),
        ),
        default: "ask",
        scope: "host",
        choices: [
          { value: "ask", label: "ask", badge: "Ask before loading a new folder's project files" },
          { value: "always", label: "always", badge: "Load every folder's project files" },
          {
            value: "never",
            label: "never",
            badge: "Load project files only from folders you trusted",
          },
        ],
      },
    ],
  },
  activate(api) {
    const inputs = tryReadResources(api);

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
              `- ${skill.name}: ${skill.description === "" ? "(no description)" : skill.description} (${skill.location})`,
          ),
        ].join("\n"),
      });

    api.contribute.skills.add((draft) => {
      for (const skill of inputs.skills)
        draft.set(skill.name, {
          name: skill.name,
          description: skill.description,
          location: skill.location,
        });
    });
  },
};

function tryReadResources(api: PluginApi<"core">): Resources | null {
  try {
    return api.inputs;
  } catch {
    return null;
  }
}

async function scan(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
): Promise<Resources> {
  const record = await readWorkspace(kernel, workspace);
  const user = await userFiles(kernel);

  const trusted = record !== null && (await projectTrust(kernel, record)) === true;

  const attached =
    record !== null &&
    classifyFileSupport(kernel.environments.provider(record.target.kind)) === "available"
      ? kernel.env(session)
      : null;

  const env =
    attached === null ? null : trusted ? await attached : await attached.catch(() => null);
  const folder = env?.files ?? null;
  const project = trusted ? folder : null;
  const root = env !== null && env.cwd.startsWith("/") ? env.cwd : null;
  const home = kernel.home;

  const [projectSkills, userSkills, pathSkills] = await Promise.all([
    project === null ? [] : skillsIn(project, SKILL_DIRECTORIES, "project"),
    user === null ? [] : skillsIn(user, SKILL_DIRECTORIES, "user"),
    user === null ? [] : skillsAt(user, await skillPaths(kernel)),
  ]);

  const { kept: skills, dropped } = byName([
    ...projectSkills,
    ...[...userSkills, ...pathSkills].map((skill) =>
      home === null || /^(?:\/|[A-Za-z]:[\\/])/.test(skill.location)
        ? skill
        : { ...skill, location: join(home, skill.location) },
    ),
  ]);

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

  if (folder !== null && root !== null) contextFiles.push(...(await ancestorFiles(folder, root)));

  if (folder !== null) {
    const found = await firstContext(folder, (name) => name);

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

/**
 * Decides whether a workspace's project files may load, the way pi does:
 * the folder's own decision, else the nearest registered parent folder's
 * decision, else the host's `workspaceTrust` mode, where `ask` gives `null`.
 * The host's home folder holds the user's own files, so it is never a
 * project and never passes trust down.
 */
export type TrustResolver = (
  record: Pick<WorkspaceRecord, "target" | "projectResources">,
) => boolean | null;

/**
 * Reads the workspace records and the `workspaceTrust` mode once and returns
 * a {@link TrustResolver} over them; reuse it when resolving many workspaces.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function readTrustResolver(kernel: Kernel): Promise<TrustResolver> {
  const [records, mode] = await Promise.all([
    workspaceRecords(kernel),
    readKv(kernel, kvRef("host", "settings", WORKSPACE_TRUST)),
  ]);

  const home = kernel.home?.replace(/\/+$/u, "") ?? null;

  const folder = (target: WorkspaceRecord["target"]): string | null =>
    "path" in target ? target.path.replace(/\/+$/u, "") : null;

  const fallback = mode === "always" ? true : mode === "never" ? false : null;

  return (record) => {
    const path = folder(record.target);

    if (path !== null && path === home) return false;

    if (record.projectResources !== null) return record.projectResources;

    if (path === null) return fallback;

    const parent = records
      .flatMap((other) => {
        const above = folder(other.target);

        return other.target.kind === record.target.kind &&
          other.projectResources !== null &&
          above !== null &&
          above !== home &&
          path.startsWith(`${above}/`)
          ? [{ depth: above.length, trusted: other.projectResources }]
          : [];
      })
      .toSorted((a, b) => b.depth - a.depth)[0];

    return parent?.trusted ?? fallback;
  };
}

/**
 * Whether one workspace's project files may load; see {@link TrustResolver}.
 *
 * @category workspaces
 * @since 0.1.0
 */
export async function projectTrust(
  kernel: Kernel,
  record: Pick<WorkspaceRecord, "target" | "projectResources">,
): Promise<boolean | null> {
  const home = kernel.home?.replace(/\/+$/u, "") ?? null;
  const path = "path" in record.target ? record.target.path.replace(/\/+$/u, "") : null;

  if (record.projectResources !== null && (path === null || path !== home))
    return record.projectResources;

  return (await readTrustResolver(kernel))(record);
}

async function skillPaths(kernel: Kernel): Promise<readonly string[]> {
  const value = await readKv(kernel, kvRef("host", "settings", SKILL_PATHS));

  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" ? [entry] : []))
    : [];
}

async function skillsIn(
  files: FilesApi,
  directories: readonly string[],
  scope: Skill["scope"],
): Promise<readonly Skill[]> {
  const found: Skill[] = [];

  for (const directory of directories) {
    for (const name of await listDirectChildren(files, directory, "directory")) {
      const location = `${directory}/${name}/SKILL.md`;
      const content = await readText(files, location);

      if (content !== null) found.push(parseSkillMetadata(content, name, location, scope));
    }
  }

  return found;
}

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

    if (content !== null) found.push(parseSkillMetadata(content, name, path, "path"));
  }

  return found;
}

async function promptsIn(files: FilesApi, scope: Prompt["scope"]): Promise<readonly Prompt[]> {
  const names = await listDirectChildren(files, ".nyte/prompts", "file");

  return names.flatMap((name) =>
    name.endsWith(".md")
      ? [{ name: name.slice(0, -".md".length), location: `.nyte/prompts/${name}`, scope }]
      : [],
  );
}

function parseSkillMetadata(
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

async function ancestorFiles(files: FilesApi, root: string): Promise<readonly ContextFile[]> {
  const found: ContextFile[] = [];

  try {
    for (const directory of listAncestorPaths(root)) {
      const context = await firstContext(files, (name) => join(directory, name));

      if (context !== null) found.push({ ...context, scope: "ancestor" });
    }
  } catch {
    return [];
  }

  return found;
}

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

async function listDirectChildren(
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

async function readText(files: FilesApi, path: string): Promise<string | null> {
  const document = await files.read(path).catch((error: unknown) => {
    if (error instanceof SdkError && error.code === "invalid") return null;

    throw error;
  });

  return document?.kind === "text" ? document.contents : null;
}

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

function byName<T extends { readonly name: string }>(items: readonly T[]) {
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

function listAncestorPaths(root: string): readonly string[] {
  const parts = root.split("/").filter((part) => part !== "");

  return parts.map((_part, index) => `/${parts.slice(0, index).join("/")}`);
}

function join(directory: string, name: string): string {
  return directory.endsWith("/") ? `${directory}${name}` : `${directory}/${name}`;
}
