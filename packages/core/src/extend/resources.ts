import { SdkError, standard } from "@nyte-ai/schema";
import type {
  FileEntryView,
  SessionId,
  SharedDoc,
  ValidationIssue,
  WorkspaceId,
} from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import { Type } from "typebox";
import { isMap, isScalar, parseDocument } from "yaml";
import type { Kernel } from "../contract/kernel.ts";
import type { Plugin, PluginApi } from "../contract/plugin.ts";
import type {
  EnvironmentProvider,
  ExecutionEnv,
  FilesApi,
  Resources,
  RootWatch,
  ScanEntry,
} from "../contract/workspace.ts";
import { classifyFileSupport, readWorkspace } from "../env/environment.ts";
import { projectTrust, WORKSPACE_TRUST } from "../env/trust.ts";
import { kvRef } from "../store/refs.ts";
import { readKv, requireSession } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import type { StoreConnection } from "../contract/store.ts";
import { publishViews } from "./part-views.ts";
import { PLUGIN_FOLDER, reloadUserPlugins, samePlugins, sessionPlugins } from "./plugin-folders.ts";

type Skill = Resources["skills"][number];

type ContextFile = Resources["contextFiles"][number];

type PromptInputs = Pick<Resources, "contextFiles" | "prompt">;

const CONTEXT_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

/** Resolves an absolute path to its real one on the machine some files are on, null where nothing resolves (`EnvironmentProvider.realpath`). */
type RealPath = (path: string) => Promise<string | null>;

/** Files on one machine, and its real paths where its provider resolves them. */
type Reader = { readonly files: FilesApi; readonly real: RealPath | null };

type FoundContext = ContextFile & {
  /** The name in `CONTEXT_NAMES` it was read under. */
  readonly name: string;
  /** Its real path, which names the file however it was reached; the path it was read at where the machine resolves none. */
  readonly real: string;
  /** Its folder's real path joined with `name`, what `findShadowedContext` answers for a shadowed file. */
  readonly entry: string;
};

const SKILL_DIRECTORIES = [".nyte/skills", ".agents/skills"];

/** Where a project's shared docs live, under the home and under the workspace. */
export const SHARED_DOCS = ".nyte/projects/docs";

/** The home's key in `WorkspaceState.watches`; a workspace's is its id. */
const HOME = "home";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;

const LINK_HOPS = 8;

export const SKILL_PATHS = "skills.paths";

const scanIssues = new WeakMap<Resources, readonly ValidationIssue[]>();

/** Returns the session's resources, scanned once and kept until a folder they load from changes. Before the scan reads them, the session joins the watches on those folders (`refresh` answers a change), so a change during the scan still counts. */
export async function scanResources(kernel: Kernel, session: SessionId): Promise<Resources> {
  const record = (await requireSession(kernel.store, session)).record;
  const workspace = record.workspace;
  const contextFiles = record.contextFiles ?? true;
  const table = kernel.workspaceState.scans;
  const cached = table.get(session);

  if (cached !== undefined && cached.workspace === workspace) return cached.resources;

  const entry: ScanEntry = {
    workspace,
    resources: follow(kernel, session, workspace)
      .then(() => scan(kernel, workspace, () => kernel.environments.attach(session), contextFiles))
      .then((resources) => {
        const api = kernel.plugins.runtimes().get(session)?.api("resources");

        for (const issue of resourceIssues(resources)) api?.report(issue);

        return resources;
      }),
  };

  table.set(session, entry);
  entry.resources.catch(() =>
    dropScans(kernel, (key, known) => key === session && known === entry),
  );

  return entry.resources;
}

/** Drops the cached scans `chosen` picks (every one by default), so their sessions scan again; the watches stay. */
export function dropScans(
  kernel: Kernel,
  chosen: (session: SessionId, entry: ScanEntry) => boolean = () => true,
): void {
  const table = kernel.workspaceState.scans;

  for (const [session, entry] of table) if (chosen(session, entry)) table.delete(session);
}

/** Drops the scans of the sessions `chosen` picks (every one by default) and takes those sessions off the watches, stopping each watch no session is left on. */
export function forgetScans(
  kernel: Kernel,
  chosen: (session: SessionId) => boolean = () => true,
): void {
  dropScans(kernel, (session) => chosen(session));
  const watches = kernel.workspaceState.watches;

  for (const [key, watch] of watches) {
    for (const session of watch.sessions) if (chosen(session)) watch.sessions.delete(session);

    if (watch.sessions.size > 0 || watch.kept) continue;
    watches.delete(key);
    watch.stop();
  }
}

/** Starts the home's watch for the host's lifetime, so a change under `<home>/.nyte/plugins` reloads the host's own plugins with no chat open. */
export async function watchHome(kernel: Kernel): Promise<void> {
  const home = await attachHome(kernel).catch(() => null);

  if (home === null) return;
  watchRoot(kernel, HOME, home.files, null, await homePaths(kernel), true);
}

/** Closes the watches as the host closes: no watch starts and no change is answered after, every scan is dropped, every watch (the home's too) stops, and the changes already being answered finish first, so none reloads a plugin on a closing host. */
export async function closeWatches(kernel: Kernel): Promise<void> {
  const state = kernel.workspaceState;
  state.closed = true;
  state.scans.clear();
  const stopped = [...state.watches.values()];
  state.watches.clear();

  for (const watch of stopped) watch.stop();
  await Promise.all(stopped.map((watch) => watch.settled()));
}

/** Scans the resources a new chat in `workspace` would read, before the chat exists, over the workspace's own attachment. */
export function scanWorkspaceResources(kernel: Kernel, workspace: WorkspaceId): Promise<Resources> {
  return scan(kernel, workspace, () => kernel.environments.attachWorkspace(workspace), true);
}

export function resourceIssues(resources: Resources): readonly ValidationIssue[] {
  return scanIssues.get(resources) ?? [];
}

/**
 * Reads the session's prompt files again before a request and, when they differ from its cached
 * scan, drops the scan and reloads the session's plugins, so the request about to be built and its
 * plugins' `inputs` carry them. Prompt files are read rather than watched: they sit in every
 * folder above the workspace and in `<home>/.nyte`, where a watch costs more than a read.
 */
export async function refreshPromptFiles(kernel: Kernel, session: SessionId): Promise<void> {
  const cached = kernel.workspaceState.scans.get(session);

  if (cached === undefined) return;
  const resources = await cached.resources.catch(() => null);
  const record = (await requireSession(kernel.store, session)).record;

  if (resources === null || record.workspace !== cached.workspace) return;

  const found = await readers(kernel, record.workspace, () => kernel.environments.attach(session));

  const fresh = await readPromptInputs(kernel, found, record.contextFiles ?? true);
  const known: PromptInputs = { contextFiles: resources.contextFiles, prompt: resources.prompt };

  if (JSON.stringify(fresh) === JSON.stringify(known)) return;
  dropScans(kernel, (key, entry) => key === session && entry === cached);
  await kernel.plugins.reload(session);
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
  workspace: WorkspaceId,
  attach: () => Promise<ExecutionEnv>,
  withContext: boolean,
): Promise<Resources> {
  const found = await readers(kernel, workspace, attach);
  const user = found.homeEnv?.files ?? null;
  const home = kernel.home;

  const [inputs, projectSkills, userSkills, pathSkills, projectDocs, userDocs] = await Promise.all([
    readPromptInputs(kernel, found, withContext),
    found.project === null ? [] : skillsIn(found.project, SKILL_DIRECTORIES, "project", found.root),
    user === null ? [] : skillsIn(user, SKILL_DIRECTORIES, "user", home),
    user === null ? [] : skillsAt(user, await skillPaths(kernel.store), home),
    found.project === null ? [] : docsIn(found.project, "project", null),
    user === null ? [] : docsIn(user, "user", home),
  ]);

  const { kept: skills, dropped } = byName([
    ...projectSkills,
    ...[...userSkills, ...pathSkills].map((skill) =>
      home === null || ABSOLUTE.test(skill.location)
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

  const resources: Resources = {
    user,
    project: found.project,
    skills,
    docs: [...projectDocs, ...userDocs],
    ...inputs,
  };

  scanIssues.set(resources, issues);

  return resources;
}

/** The prompt files `found` reads: the context files (the user's in `<home>/.nyte`, each ancestor's, then the folder's own) when `withContext`, and `.nyte/SYSTEM.md` and `.nyte/APPEND_SYSTEM.md`, a trusted folder's before the user's. */
async function readPromptInputs(
  kernel: Kernel,
  found: Awaited<ReturnType<typeof readers>>,
  withContext: boolean,
): Promise<PromptInputs> {
  const user = found.homeEnv?.files ?? null;
  const home = kernel.home;

  const [contextFiles, userSystem, userAppend, projectSystem, projectAppend] = await Promise.all([
    withContext
      ? findContextFiles(
          found.homeEnv === null || home === null
            ? null
            : {
                files: found.homeEnv.files,
                real: realPaths(kernel.environments.provider("local"), found.homeEnv),
                home,
              },
          found.env === null
            ? null
            : {
                files: found.env.files,
                real: realPaths(found.provider, found.env),
                root: found.root,
              },
        )
      : [],
    user === null ? null : readText(user, ".nyte/SYSTEM.md"),
    user === null ? null : readText(user, ".nyte/APPEND_SYSTEM.md"),
    found.project === null ? null : readText(found.project, ".nyte/SYSTEM.md"),
    found.project === null ? null : readText(found.project, ".nyte/APPEND_SYSTEM.md"),
  ]);

  return {
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
  };
}

/** What a workspace's files are read through: the home's environment, the workspace's (null where its provider serves no files or, untrusted, it does not attach), the workspace's files again as `project` once it is trusted, and its root as an absolute path. */
async function readers(
  kernel: Kernel,
  workspace: WorkspaceId,
  attach: () => Promise<ExecutionEnv>,
) {
  const record = await readWorkspace(kernel.store, workspace);
  const homeEnv = await attachHome(kernel);
  const trusted = record !== null && (await projectTrust(kernel, record)) === true;
  const provider = record === null ? undefined : kernel.environments.provider(record.target.kind);
  const attached = classifyFileSupport(provider) === "available" ? attach() : null;

  const env =
    attached === null ? null : trusted ? await attached : await attached.catch(() => null);

  return {
    homeEnv,
    provider,
    env,
    project: trusted ? (env?.files ?? null) : null,
    root: env !== null && env.cwd.startsWith("/") ? env.cwd : null,
  };
}

/** Puts `session` on the watches of the folders its resources load from: the home's (`homePaths`) and, once the workspace is trusted, the workspace's (`.nyte/plugins` and the skill folders), which watches through the files of the first session on it. */
async function follow(kernel: Kernel, session: SessionId, workspace: WorkspaceId): Promise<void> {
  const home = await attachHome(kernel).catch(() => null);

  if (home !== null) watchRoot(kernel, HOME, home.files, session, await homePaths(kernel));

  const record = await readWorkspace(kernel.store, workspace);

  if (record === null || (await projectTrust(kernel, record)) !== true) return;

  if (classifyFileSupport(kernel.environments.provider(record.target.kind)) !== "available") return;
  const env = await kernel.environments.attach(session).catch(() => null);

  if (env !== null)
    watchRoot(kernel, workspace, env.files, session, [
      ...SKILL_DIRECTORIES,
      SHARED_DOCS,
      PLUGIN_FOLDER,
    ]);
}

/** The folders the home's watch covers: `.nyte/plugins`, the skill folders, the shared docs and the skill paths. */
async function homePaths(kernel: Kernel): Promise<readonly string[]> {
  return [
    ...SKILL_DIRECTORIES,
    SHARED_DOCS,
    PLUGIN_FOLDER,
    ...userSkillPaths(await skillPaths(kernel.store)),
  ];
}

/** Adds `session` (none for the host's own) to the watch on `key`'s `paths`, starting the watch, or restarting it when its paths changed. */
function watchRoot(
  kernel: Kernel,
  key: string,
  files: FilesApi,
  session: SessionId | null,
  paths: readonly string[],
  kept = false,
): void {
  const watches = kernel.workspaceState.watches;
  const joined = paths.join("\n");
  const known = watches.get(key);

  if (kernel.workspaceState.closed) return;

  if (known !== undefined && known.paths === joined && (known.kept || !kept)) {
    if (session !== null) known.sessions.add(session);

    return;
  }

  known?.stop();
  const events = files.watch({ paths })[Symbol.asyncIterator]();
  const changes = serial();

  const watch: RootWatch = {
    paths: joined,
    sessions: new Set([...(known?.sessions ?? []), ...(session === null ? [] : [session])]),
    kept: kept || known?.kept === true,
    stop: () => void events.return?.(),
    settled: () => changes.settled(),
  };

  watches.set(key, watch);
  void drain(kernel, key, watch, events, changes);
}

/** Answers a watch's changes one batch at a time, folding the changes that arrive while a batch waits into it, until the watch ends. A watch that ends unasked (its files closed with the session that lent them) leaves its key and refreshes its sessions, which watch again through files of their own. */
async function drain(
  kernel: Kernel,
  key: string,
  watch: RootWatch,
  events: AsyncIterator<readonly { readonly path: string }[]>,
  changes: ReturnType<typeof serial>,
): Promise<void> {
  let waiting: string[] | null = null;

  try {
    for (;;) {
      const next = await events.next();

      if (next.done === true) return;

      if (next.value.length === 0) continue;
      const queued = waiting !== null;
      waiting = [...(waiting ?? []), ...next.value.map((event) => event.path)];

      if (queued) continue;
      void changes
        .run(async () => {
          const paths = waiting ?? [];
          waiting = null;
          await refreshRoot(kernel, key, watch, paths);
        })
        .catch((error: unknown) =>
          dev("resources", "refresh failed", { key, error: String(error) }),
        );
    }
  } catch (error) {
    dev("resources", "watch failed", { key, error: String(error) });
  } finally {
    if (kernel.workspaceState.watches.get(key) === watch) {
      kernel.workspaceState.watches.delete(key);
      void changes
        .run(async () => {
          for (const session of watch.sessions) await refresh(kernel, session);
        })
        .catch((error: unknown) =>
          dev("resources", "refresh failed", { key, error: String(error) }),
        );
    }
  }
}

/** Answers changes under a root: under the home's `.nyte/plugins` the host's own plugins reload; any other change refreshes the sessions on the watch. */
async function refreshRoot(
  kernel: Kernel,
  key: string,
  watch: RootWatch,
  paths: readonly string[],
): Promise<void> {
  if (kernel.workspaceState.closed) return;

  const plugins = paths.filter(
    (path) => path === PLUGIN_FOLDER || path.startsWith(`${PLUGIN_FOLDER}/`),
  );

  if (key === HOME && plugins.length > 0) {
    await reloadUserPlugins(kernel);
    await publishViews(kernel);
  }

  if (key === HOME && plugins.length === paths.length) return;

  for (const session of watch.sessions) await refresh(kernel, session);
}

/** Scans `session`'s resources again and reloads its plugins when what they read, or the plugins it would load now (its assigned files loaded again, or a new chat's in its workspace), differ from what it runs. Nothing reloads once the host closes its watches. */
async function refresh(kernel: Kernel, session: SessionId): Promise<void> {
  const before = kernel.workspaceState.scans.get(session);
  dropScans(kernel, (key) => key === session);
  const runtime = kernel.plugins.runtimes().get(session);

  if (runtime === undefined || kernel.workspaceState.closed) return;
  const after = await scanResources(kernel, session);
  const read = await before?.resources.catch(() => null);
  const workspace = kernel.workspaceState.scans.get(session)?.workspace;

  const plugins =
    workspace === undefined
      ? null
      : await sessionPlugins(kernel, runtime, workspace).catch(() => null);

  const unchanged =
    read !== undefined &&
    read !== null &&
    sameInputs(read, after) &&
    plugins !== null &&
    samePlugins(runtime.requested(), plugins);

  if (unchanged || kernel.workspaceState.closed) return;
  await kernel.plugins.reload(session);
}

/** Whether two scans read the same skills and prompt files. */
function sameInputs(left: Resources, right: Resources): boolean {
  const read = (resources: Resources) =>
    JSON.stringify([resources.skills, resources.contextFiles, resources.prompt]);

  return read(left) === read(right);
}

function attachHome(kernel: Kernel): Promise<ExecutionEnv | null> {
  const state = kernel.workspaceState;

  if (state.home !== null) return state.home;
  const home = kernel.home;
  const local = home === null ? undefined : kernel.environments.provider("local");

  if (home === null || local === undefined) return Promise.resolve(null);
  const attached = local.attach({ kind: "local", path: home });
  state.home = attached;

  attached.catch(() => {
    if (state.home === attached) state.home = null;
  });

  return attached;
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

/** Reads `<directory>/<name>/SKILL.md` for each directory or link to one directly under `directories`, never walking into a link. Entries that resolve to the same directory load once: a real directory before a link to it, otherwise the first in `directories` order. */
async function skillsIn(
  files: FilesApi,
  directories: readonly string[],
  scope: Skill["scope"],
  root: string | null,
): Promise<readonly Skill[]> {
  const listed = await Promise.all(
    directories.map(async (directory) =>
      (await listDirectChildren(files, directory, ["directory", "symlink"])).map((entry) => ({
        ...entry,
        path: `${directory}/${entry.name}`,
      })),
    ),
  );

  const candidates = listed
    .flat()
    .toSorted((left, right) => Number(left.kind === "symlink") - Number(right.kind === "symlink"));

  const targets = await Promise.all(
    candidates.map(async ({ kind, path }) =>
      kind === "directory" ? resolvePath(root, path) : linkedDirectory(files, path, root),
    ),
  );

  const loaded = new Set<string>();

  const read = await Promise.all(
    candidates.map(async ({ name, path }, index) => {
      const target = targets[index];

      if (target === undefined || target === null || loaded.has(target)) return [];
      loaded.add(target);
      const location = `${path}/SKILL.md`;
      const content = await readText(files, location);

      return content === null ? [] : [parseSkillMetadata(content, name, location, scope)];
    }),
  );

  return read.flat();
}

/** Follows the link at `path` through `files` to the directory it names, or null when it is broken, names a file, or takes more than `LINK_HOPS` links (a cycle). */
async function linkedDirectory(
  files: FilesApi,
  path: string,
  root: string | null,
): Promise<string | null> {
  let at = resolvePath(root, path);

  for (let hop = 0; hop < LINK_HOPS; hop += 1) {
    const found = await files.stat(at).catch(() => null);

    if (found?.kind === "directory") return at;

    if (found?.kind !== "symlink" || found.target === undefined) return null;
    const parent = at.slice(0, Math.max(at.lastIndexOf("/"), 0));
    at = resolvePath(root, ABSOLUTE.test(found.target) ? found.target : join(parent, found.target));
  }

  return null;
}

/** Normalizes `path` against `root`: relative to it when inside it, else absolute (or relative when `root` is unknown). */
function resolvePath(root: string | null, path: string): string {
  const full = root === null || ABSOLUTE.test(path) ? path : join(root, path);
  const absolute = full.startsWith("/");
  const parts: string[] = [];

  for (const part of full.split("/")) {
    if (part === "" || part === "." || (part === ".." && absolute && parts.length === 0)) continue;

    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }

  const normal = `${absolute ? "/" : ""}${parts.join("/")}`;

  return root !== null && normal.startsWith(join(root, ""))
    ? normal.slice(join(root, "").length)
    : normal;
}

async function skillsAt(
  files: FilesApi,
  paths: readonly string[],
  root: string | null,
): Promise<readonly Skill[]> {
  const found = await Promise.all(
    userSkillPaths(paths).map(async (path): Promise<readonly Skill[]> => {
      if (!path.endsWith(".md")) return skillsIn(files, [path], "path", root);
      const content = await readText(files, path);
      const name = path.split("/").at(-1)?.slice(0, -".md".length) ?? path;

      return content === null ? [] : [parseSkillMetadata(content, name, path, "path")];
    }),
  );

  return found.flat();
}

/** The files directly in `SHARED_DOCS` under `files`, each with the `description` its Markdown frontmatter gives, located under `base` when it is known (the home), else relative to the folder. */
async function docsIn(
  files: FilesApi,
  scope: SharedDoc["scope"],
  base: string | null,
): Promise<readonly SharedDoc[]> {
  const entries = await listDirectChildren(files, SHARED_DOCS, ["file", "symlink"]);

  return Promise.all(
    entries.map(async ({ name }): Promise<SharedDoc> => {
      const path = join(SHARED_DOCS, name);
      const content = name.endsWith(".md") ? await readText(files, path) : null;

      return {
        id: `${scope}:${name}`,
        name,
        scope,
        location: base === null ? path : join(base, path),
        description: content === null ? "" : (frontmatter(content).get("description") ?? ""),
      };
    }),
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

/** The context files a session reads, in order: the user's in `<home>/.nyte`, each ancestor's from the root down, then the folder's own, each folder's first of `CONTEXT_NAMES`. A file met again by another path (`~/.nyte` above a worktree in `~/.nyte/worktrees`, a symlink) keeps its first place and scope, and the main repository's file that a linked worktree nested in it shadows is left out. */
async function findContextFiles(
  user: (Reader & { readonly home: string }) | null,
  folder: (Reader & { readonly root: string | null }) | null,
): Promise<readonly ContextFile[]> {
  const root = folder?.root ?? null;

  const [own, ancestors, project, shadowed] = await Promise.all([
    user === null ? null : findContext(user, join(user.home, ".nyte"), "user"),
    folder === null || root === null ? [] : ancestorContexts(folder, root),
    folder === null ? null : findContext(folder, root, "project"),
    folder === null || root === null ? null : findShadowedContext(folder, root).catch(() => null),
  ]);

  const seen = new Set<string>();

  return [own, ...ancestors, project].flatMap((found) => {
    if (found === null || found.entry === shadowed || seen.has(found.real)) return [];
    seen.add(found.real);

    return [{ path: found.path, scope: found.scope, content: found.content }];
  });
}

/** The ancestors' context files, root first; none where reading above the folder fails, as in a sandbox confined to its root. */
async function ancestorContexts(reader: Reader, root: string): Promise<readonly FoundContext[]> {
  try {
    const found = await Promise.all(
      listAncestorPaths(root).map((directory) => findContext(reader, directory, "ancestor")),
    );

    return found.filter((context) => context !== null);
  } catch {
    return [];
  }
}

/** The first of `CONTEXT_NAMES` that reads as text in `directory` (null: the files' root, read by relative path). Its path keeps `directory` as given and spells the name as the disk does: a case-insensitive disk reads `AGENTS.md` from an `AGENTS.MD`, whose real path has the name that exists. A link keeps its own name. */
async function findContext(
  reader: Reader,
  directory: string | null,
  scope: ContextFile["scope"],
): Promise<FoundContext | null> {
  const at = (name: string): string => (directory === null ? name : join(directory, name));

  const read = await Promise.all(
    CONTEXT_NAMES.map(async (name) => ({ name, content: await readText(reader.files, at(name)) })),
  );

  const found = read.find(
    (entry): entry is { readonly name: string; readonly content: string } => entry.content !== null,
  );

  if (found === undefined) return null;
  const path = at(found.name);

  if (reader.real === null || directory === null)
    return { path, scope, content: found.content, name: found.name, real: path, entry: path };

  const [real, realDirectory, entry] = await Promise.all([
    reader.real(path),
    reader.real(directory),
    reader.files.stat(path),
  ]);

  return {
    path: real === null || entry?.kind === "symlink" ? path : join(directory, fileName(real)),
    scope,
    content: found.content,
    name: found.name,
    real: real ?? path,
    entry: join(realDirectory ?? directory, found.name),
  };
}

/**
 * pi's `findShadowedContextFile`: the main repository's context file that a linked worktree
 * nested inside it shadows with its own, both covering one repository, or null. Nothing is
 * shadowed for an ordinary repository, where the worktree and the main repository are one folder;
 * a sibling worktree (`git worktree add ../feat`), whose main repository is no ancestor; a bare
 * layout (`proj/.bare` + `proj/main`), where the common git directory's parent is the folder
 * holding `.bare`, which checks nothing out; a submodule, whose git directory has no `commondir`
 * and sits under `.git/modules`; or a machine without real paths. Compared as real paths: git
 * writes `gitdir:` in that form while the folder may be reached through a symlink (macOS `/tmp` is
 * `/private/tmp`).
 */
async function findShadowedContext(reader: Reader, root: string): Promise<string | null> {
  const real = reader.real;

  if (real === null) return null;
  const git = await findGitPaths(reader.files, root);

  if (git === null) return null;
  const common = (await real(git.common)) ?? git.common;
  const worktree = (await real(git.repository)) ?? git.repository;
  const main = parentDirectory(common);

  if (!worktree.startsWith(join(main, ""))) return null;
  const mainGit = join(main, ".git");

  if (((await real(mainGit)) ?? mainGit) !== common) return null;
  const own = await findContext(reader, worktree, "ancestor");

  return own === null ? null : join(main, own.name);
}

/** pi's `findGitPaths` through `files`: the nearest folder at or above `root` holding a `.git`, with its common git directory: a `.git` folder itself, or the `gitdir:` a `.git` file names, through that directory's `commondir` when it has one (a linked worktree's). Null when that git directory has no `HEAD`. */
async function findGitPaths(
  files: FilesApi,
  root: string,
): Promise<{ readonly repository: string; readonly common: string } | null> {
  for (const directory of [root, ...listAncestorPaths(root).toReversed()]) {
    const dotGit = join(directory, ".git");
    const found = await files.stat(dotGit);

    if (found === null) continue;
    const text = found.kind === "directory" ? null : await readText(files, dotGit);

    if (text === null) {
      if (found.kind === "file") continue;

      return (await files.stat(join(dotGit, "HEAD"))) === null
        ? null
        : { repository: directory, common: dotGit };
    }

    const named = text.trim();

    if (!named.startsWith("gitdir: ")) continue;
    const gitDir = absolutePath(directory, named.slice("gitdir: ".length).trim());

    if ((await files.stat(join(gitDir, "HEAD"))) === null) return null;
    const common = await readText(files, join(gitDir, "commondir"));

    return {
      repository: directory,
      common: common === null ? gitDir : absolutePath(gitDir, common.trim()),
    };
  }

  return null;
}

function realPaths(provider: EnvironmentProvider | undefined, env: ExecutionEnv): RealPath | null {
  const realpath = provider?.realpath;

  return realpath === undefined ? null : (path) => realpath(env, path);
}

async function listDirectChildren(
  files: FilesApi,
  directory: string,
  kinds: readonly FileEntryView["kind"][],
): Promise<readonly { readonly name: string; readonly kind: FileEntryView["kind"] }[]> {
  const children = new Map<string, FileEntryView["kind"]>();

  for await (const frame of files.scan({ directory })) {
    if (frame.kind !== "entries") continue;

    for (const entry of frame.entries) {
      const relative = entry.path.startsWith(`${directory}/`)
        ? entry.path.slice(directory.length + 1)
        : entry.path;

      if (kinds.includes(entry.kind) && relative !== "" && !relative.includes("/"))
        children.set(relative, entry.kind);
    }
  }

  return [...children]
    .map(([name, kind]) => ({ name, kind }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/** The text file at `path`, or null where none is or it is not text. */
export async function readText(files: FilesApi, path: string): Promise<string | null> {
  const document = await files.read(path).catch((error: unknown) => {
    if (error instanceof SdkError && error.code === "invalid") return null;

    throw error;
  });

  return document?.kind === "text" ? document.contents : null;
}

/** Reads the frontmatter's scalar fields as YAML, or line by line (`key: value`, outer quotes dropped) when it is not valid YAML. */
function frontmatter(content: string): ReadonlyMap<string, string> {
  const block = FRONTMATTER.exec(content)?.[1];

  if (block === undefined) return new Map();
  const document = parseDocument(block);

  if (document.errors.length > 0 || !isMap(document.contents)) return frontmatterLines(block);
  const fields = new Map<string, string>();

  for (const { key, value } of document.contents.items) {
    if (!isScalar(key) || !isScalar(value)) continue;
    const text = value.value === null ? "" : value.toString().trim();

    if (text !== "") fields.set(String(key.value), text);
  }

  return fields;
}

function frontmatterLines(block: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();

  for (const line of block.split(/\r?\n/)) {
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

function absolutePath(base: string, path: string): string {
  return resolvePath(null, ABSOLUTE.test(path) ? path : join(base, path));
}

function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
