import type { SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Resources } from "./environment.ts";
import type { Kernel } from "./kernel.ts";

/** Resolves what core scanned for a session (baseline §4c-bis), through `FilesApi` only, scanned once and cached until `invalidateResources` drops its workspace. `user` is the files of the `"local"` provider attached once per kernel at `kernel.home`, the parent of `.nyte` (decision 9), so `.nyte/…` and `.agents/skills/…` are paths under it; null without a home or a `"local"` provider, and then no user source is read. `project` is the session's environment files (`kernel.env`), rooted at the workspace, when its workspace has `projectResources`; otherwise null and every project and ancestor source is hidden. Skills: each `<dir>/<name>/SKILL.md` under `.nyte/skills` and `.agents/skills` of user then project, plus each path of the host setting `skills.paths` (a directory scanned the same way, or one `.md`, read through `user`), named and described by the file's frontmatter `name` and `description` (the directory or file name when `name` is absent), `location` the path as read through its scope's files; one per name, project over user over path, a dropped duplicate reported as a warning on the `resources` plugin's row when that plugin is active in the session. Context files, in prompt order: `.nyte/AGENTS.md` of user; then from `/` down to the workspace root's parent, the first of `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md` per directory (ancestor, absolute paths through `project`); then the same in the workspace root (project). Prompt: `SYSTEM.md` and `APPEND_SYSTEM.md` from `.nyte`, each the project's file over the user's, `scope` project when either came from the project, user when either came from the user, else null. Prompts: each `.md` under `.nyte/prompts`, named by its file name without `.md`, project over user. What `kernel.resources(session)` resolves; throws `unknown` when the session is gone. */
export function scanResources(kernel: Kernel, session: SessionId): Promise<Resources> {
  throw new Error("not implemented");
}

/** Drops the cached resources of every session on a workspace, so the next `scanResources` reads again: what `Workspace.update`, `reload` and `forget` do. */
export function invalidateResources(kernel: Kernel, workspace: WorkspaceId): void {
  throw new Error("not implemented");
}
