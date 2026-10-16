import { SdkError, standard } from "@nyte-ai/schema";
import type { SessionId, ValidationIssue, WorkspaceId } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Kernel } from "../contract/kernel.ts";
import type { Plugin, PluginApi } from "../contract/plugin.ts";
import type { FilesApi, Resources, ScanEntry } from "../contract/workspace.ts";
import { classifyFileSupport, readWorkspace } from "../env/environment.ts";
import { projectTrust, WORKSPACE_TRUST } from "../env/trust.ts";
import { kvRef } from "../store/refs.ts";
import { readKv, requireSession } from "../store/session.ts";
import type { StoreConnection } from "../contract/store.ts";

type Skill = Resources["skills"][number];

type Prompt = Resources["prompts"][number];

type ContextFile = Resources["contextFiles"][number];

const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"];

const SKILL_DIRECTORIES = [".nyte/skills", ".agents/skills"];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export const SKILL_PATHS = "skills.paths";

const scanIssues = new WeakMap<Resources, readonly ValidationIssue[]>();

/** Returns the session's resources, scanned once and cached until a skill file under a scanned skill directory or path moves, which drops the scan and reloads the session's plugins so the skill list follows the disk. */
export async function scanResources(kernel: Kernel, session: SessionId): Promise<Resources> {
  const workspace = (await requireSession(kernel.store, session)).record.workspace;
  const table = kernel.workspaceState.scans;
  const cached = table.get(session);

  if (cached !== undefined && cached.workspace === workspace) return cached.resources;
  dropScans(kernel, (key) => key === session);
  const watching = new AbortController();

  const entry: ScanEntry = {
    workspace,
    resources: scan(kernel, session, workspace),
    stop: () => watching.abort(),
  };

  table.set(session, entry);

  const moved = (): void => {
    if (table.get(session) !== entry) return;
    dropScans(kernel, (key) => key === session);
    void kernel.reloadPlugins(session).catch(() => undefined);
  };

  entry.resources.then(
    async (resources) => {
      const paths = userSkillPaths(await skillPaths(kernel.store));

      for (const [files, watched] of [
        [resources.project, SKILL_DIRECTORIES],
        [resources.user, [...SKILL_DIRECTORIES, ...paths]],
      ] as const)
        if (files !== null)
          void skillsMoved(files, watched, watching.signal).then((changed) => {
            if (changed) moved();
          });
    },
    () => dropScans(kernel, (key, found) => key === session && found === entry),
  );

  return entry.resources;
}

/** Drops the cached scans `chosen` picks (every one by default) and stops each one's watch. */
export function dropScans(
  kernel: Kernel,
  chosen: (session: SessionId, entry: ScanEntry) => boolean = () => true,
): void {
  const table = kernel.workspaceState.scans;

  for (const [session, entry] of table) {
    if (!chosen(session, entry)) continue;
    table.delete(session);
    entry.stop();
  }
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

    api.contribute.skills.add((draft) => {
      for (const skill of inputs.skills)
        draft.set(skill.name, {
          name: skill.name,
          description: skill.description,
          location: skill.location,
        });
    });

    api.contribute.prompt.add((draft, siblings) => {
      const skills = siblings.skills.list().toSorted((a, b) => a.name.localeCompare(b.name));

      if (skills.length === 0) return;

      draft.set("skills", {
        id: "skills",
        order: 90,
        text: [
          "Skills: read a skill's file when its description matches the task.",
          ...skills.map(
            (skill) =>
              `- ${skill.name}: ${skill.description === "" ? "(no description)" : skill.description} (${skill.location})`,
          ),
        ].join("\n"),
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
  const record = await readWorkspace(kernel.store, workspace);
  const user = await userFiles(kernel);

  const trusted = record !== null && (await projectTrust(kernel, record)) === true;

  const attached =
    record !== null &&
    classifyFileSupport(kernel.environments.provider(record.target.kind)) === "available"
      ? kernel.environments.attach(session)
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
    user === null ? [] : skillsAt(user, await skillPaths(kernel.store)),
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

/** Resolves true once a file under one of `paths` moves in `files`, false when the watch ends, fails or `signal` aborts first. */
async function skillsMoved(
  files: FilesApi,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const events = files.watch({ paths })[Symbol.asyncIterator]();
  const stop = (): void => void events.return?.();
  signal.addEventListener("abort", stop, { once: true });

  try {
    for (;;) {
      const next = await events.next();

      if (next.done === true || signal.aborted) return false;

      if (next.value.length > 0) return true;
    }
  } catch {
    return false;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}

function userSkillPaths(paths: readonly string[]): readonly string[] {
  return paths.map((raw) => (raw.startsWith("~/") ? raw.slice(2) : raw).replace(/\/+$/, ""));
}

async function skillPaths(store: StoreConnection): Promise<readonly string[]> {
  const value = await readKv(store, kvRef("host", "settings", SKILL_PATHS));

  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" ? [entry] : []))
    : [];
}

async function skillsIn(
  files: FilesApi,
  directories: readonly string[],
  scope: Skill["scope"],
): Promise<readonly Skill[]> {
  const listed = await Promise.all(
    directories.map(async (directory) =>
      (await listDirectChildren(files, directory, "directory")).map((name) => ({
        name,
        location: `${directory}/${name}/SKILL.md`,
      })),
    ),
  );

  const read = await Promise.all(
    listed.flat().map(async ({ name, location }) => {
      const content = await readText(files, location);

      return content === null ? [] : [parseSkillMetadata(content, name, location, scope)];
    }),
  );

  return read.flat();
}

async function skillsAt(files: FilesApi, paths: readonly string[]): Promise<readonly Skill[]> {
  const found = await Promise.all(
    userSkillPaths(paths).map(async (path): Promise<readonly Skill[]> => {
      if (!path.endsWith(".md")) return skillsIn(files, [path], "path");
      const content = await readText(files, path);
      const name = path.split("/").at(-1)?.slice(0, -".md".length) ?? path;

      return content === null ? [] : [parseSkillMetadata(content, name, path, "path")];
    }),
  );

  return found.flat();
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
  try {
    const found = await Promise.all(
      listAncestorPaths(root).map(async (directory): Promise<readonly ContextFile[]> => {
        const context = await firstContext(files, (name) => join(directory, name));

        return context === null ? [] : [{ ...context, scope: "ancestor" }];
      }),
    );

    return found.flat();
  } catch {
    return [];
  }
}

async function firstContext(
  files: FilesApi,
  at: (name: string) => string,
): Promise<{ readonly path: string; readonly content: string } | null> {
  const read = await Promise.all(
    CONTEXT_NAMES.map(async (name) => {
      const path = at(name);
      const content = await readText(files, path);

      return content === null ? null : { path, content };
    }),
  );

  return read.find((context) => context !== null) ?? null;
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
