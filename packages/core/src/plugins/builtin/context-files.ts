/**
 * Project context files (AGENTS.md and compatibles) as a system prompt section.
 *
 * Discovery follows pi: one context file per directory (first match of
 * AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD wins), the
 * host's global directory first, then every ancestor of the cwd from the
 * filesystem root down to the cwd itself. A main repo's context file is
 * skipped when a nested linked worktree shadows it with its own copy.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts
 * and system-prompt.ts (project context block), findGitPaths from footer-data-provider.ts.
 */
import type { EnvOps, ExecutionEnv } from "../../kernel/loop/env.ts";
import { localOps } from "../../tools/env.ts";

export interface ContextFile {
  readonly path: string;
  readonly content: string;
}

const CANDIDATES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfe_ff ? content.slice(1) : content;
}

/** Resolve a path to its real form, falling back to the raw path when it does not exist. */
async function realpathOrSelf(ops: EnvOps, path: string): Promise<string> {
  return (await ops.realpath(path).catch(() => undefined)) ?? path;
}

async function loadContextFileFromDir(
  ops: EnvOps,
  dir: string,
  warn: (message: string) => void,
): Promise<ContextFile | undefined> {
  for (const filename of CANDIDATES) {
    const filePath = ops.resolve(dir, filename);

    try {
      if ((await ops.stat(filePath))?.kind !== "file") continue;

      return { path: filePath, content: stripBom((await ops.readFile(filePath)).toString("utf8")) };
    } catch (error) {
      warn(`could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return undefined;
}

interface GitPaths {
  readonly repoDir: string;
  readonly commonGitDir: string;
}

/**
 * Find git metadata paths by walking up from cwd. Handles both regular repos
 * (`.git` is a directory) and linked worktrees (`.git` is a file).
 */
async function findGitPaths(ops: EnvOps, cwd: string): Promise<GitPaths | undefined> {
  const exists = async (path: string): Promise<boolean> => (await ops.stat(path)) !== undefined;

  const text = async (path: string): Promise<string> =>
    (await ops.readFile(path)).toString("utf8").trim();

  let dir = cwd;

  while (true) {
    const gitPath = ops.resolve(dir, ".git");

    try {
      const info = await ops.stat(gitPath);

      if (info?.kind === "file") {
        const content = await text(gitPath);

        if (content.startsWith("gitdir: ")) {
          const gitDir = ops.resolve(dir, content.slice(8).trim());

          if (!(await exists(ops.resolve(gitDir, "HEAD")))) return undefined;
          const commonDirPath = ops.resolve(gitDir, "commondir");

          const commonGitDir = (await exists(commonDirPath))
            ? ops.resolve(gitDir, await text(commonDirPath))
            : gitDir;

          return { repoDir: dir, commonGitDir };
        }
      } else if (info?.kind === "directory") {
        if (!(await exists(ops.resolve(gitPath, "HEAD")))) return undefined;

        return { repoDir: dir, commonGitDir: gitPath };
      }
    } catch {
      return undefined;
    }

    const parent = ops.resolve(dir, "..");

    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Whether `ancestor` contains `path`, walking up the environment's own paths. */
function isBelow(ops: EnvOps, path: string, ancestor: string): boolean {
  let dir = path;

  while (true) {
    const parent = ops.resolve(dir, "..");

    if (parent === dir) return false;

    if (parent === ancestor) return true;
    dir = parent;
  }
}

/**
 * The main repo's context file that a nested linked worktree's own copy shadows: both
 * occupy the same logical repository scope, so loading both applies that context twice.
 * Returns undefined when nothing is shadowed, leaving normal ancestor inheritance alone.
 *
 * Returned as realpath, because `git worktree add` writes the `.git`
 * file's `gitdir:` target in realpath form while cwd may still be symlinked
 * (macOS `/tmp` -> `/private/tmp`).
 */
async function findShadowedContextFile(
  ops: EnvOps,
  cwd: string,
  warn: (message: string) => void,
): Promise<string | undefined> {
  const gitPaths = await findGitPaths(ops, cwd);

  if (gitPaths === undefined) return undefined;
  const commonGitDir = await realpathOrSelf(ops, gitPaths.commonGitDir);
  const worktreeRoot = await realpathOrSelf(ops, gitPaths.repoDir);
  const mainRepoRoot = ops.resolve(commonGitDir, "..");

  // False for an ordinary repo, where the two are the same dir, and for a sibling
  // worktree (`git worktree add ../feat`), whose main repo is not an ancestor.
  if (!isBelow(ops, worktreeRoot, mainRepoRoot)) return undefined;

  // dirname of the common git dir is the main worktree root only when that dir is
  // itself checked out from the same repo. In a bare layout (`proj/.bare` +
  // `proj/main`) it is just the directory holding `.bare`, which tracks nothing; a
  // submodule's gitdir has no `commondir`, so it lands under `.git/modules`.
  if ((await realpathOrSelf(ops, ops.resolve(mainRepoRoot, ".git"))) !== commonGitDir)
    return undefined;

  const worktreeContextFile = await loadContextFileFromDir(ops, worktreeRoot, warn);

  const filename = CANDIDATES.find(
    (candidate) => worktreeContextFile?.path === ops.resolve(worktreeRoot, candidate),
  );

  return filename === undefined ? undefined : ops.resolve(mainRepoRoot, filename);
}

/** Global context file first, then ancestors of the environment's cwd outermost-first, cwd last. */
export async function loadProjectContextFiles(options: {
  env: ExecutionEnv;
  globalDir?: string;
  warn?: (message: string) => void;
}): Promise<ContextFile[]> {
  const warn = options.warn ?? (() => undefined);
  const { env } = options;

  const contextFiles: ContextFile[] = [];
  const seenPaths = new Set<string>();

  if (options.globalDir !== undefined) {
    const host = localOps(options.globalDir);
    const globalContext = await loadContextFileFromDir(host, host.resolve(), warn);

    if (globalContext !== undefined) {
      contextFiles.push(globalContext);
      seenPaths.add(globalContext.path);
    }
  }

  const ancestorContextFiles: ContextFile[] = [];
  const shadowedContextFile = await findShadowedContextFile(env, env.cwd, warn);
  let currentDir = env.cwd;

  while (true) {
    const contextFile = await loadContextFileFromDir(env, currentDir, warn);

    const isShadowed =
      shadowedContextFile !== undefined &&
      contextFile !== undefined &&
      (await realpathOrSelf(env, contextFile.path)) === shadowedContextFile;

    if (contextFile !== undefined && !isShadowed && !seenPaths.has(contextFile.path)) {
      ancestorContextFiles.unshift(contextFile);
      seenPaths.add(contextFile.path);
    }

    const parentDir = env.resolve(currentDir, "..");

    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  contextFiles.push(...ancestorContextFiles);

  return contextFiles;
}

/** The `<project_context>` block pi appends to the system prompt. */
export function formatContextFilesForPrompt(files: readonly ContextFile[]): string {
  if (files.length === 0) return "";
  let text = "<project_context>\n\n";
  text += "Project-specific instructions and guidelines:\n\n";

  for (const { path, content } of files) {
    text += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
  }

  text += "</project_context>";

  return text;
}
