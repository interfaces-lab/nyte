import { asId, PROJECT_EDITABLE, SdkError } from "@nyte-ai/schema";
import type { ProjectId, RefUpdate, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Project, Projects } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeProjectRecord, decodeWorkspaceRecord } from "../contract/records.ts";
import type { ProjectRecord } from "../contract/records.ts";
import { commit } from "../fold/commit.ts";
import { PROJECTS, projectRef, workspaceRef } from "../store/refs.ts";
import { attempt, load, put, readSession, STALE } from "../store/session.ts";
import type { Found } from "../store/session.ts";
import { dropScans } from "../extend/resources.ts";

export function createProjects(kernel: Kernel): Projects {
  return {
    async create(input) {
      if ((await kernel.store.refs.get(workspaceRef(input.workspace))) === null)
        throw new SdkError(
          "unknown",
          `Workspace ${input.workspace} is not registered on this host.`,
        );
      const at = Date.now();

      const project: ProjectRecord = {
        id: asId<"project">(crypto.randomUUID()),
        name: input.name,
        workspace: input.workspace,
        coordinator: null,
        models: input.models,
        instructions: input.instructions,
        skills: input.skills,
        disabledMcp: input.disabledMcp,
        disabledDocs: input.disabledDocs,
        archived: false,
        createdAt: at,
      };

      await commit(kernel, [
        {
          name: projectRef(project.id),
          target: await put(kernel.store, "project", project, at),
          expect: "absent",
        },
      ]);
      await publishProjects(kernel);

      return project;
    },
  };
}

export function projectHandle(kernel: Kernel, id: ProjectId): Project {
  return {
    id,
    async update(patch) {
      const { before, updated } = await attempt(`Updating project ${id}`, async () => {
        const found = await requireProject(kernel, id);
        const next = applyPatch(found.record, patch, PROJECT_EDITABLE);

        if (next === found.record) return { before: found.record, updated: next };

        const outcome = await commit(kernel, [
          {
            name: projectRef(id),
            target: await put(kernel.store, "project", next),
            expect: found.ref.revision,
          },
        ]);

        return outcome.kind === "set" ? { before: found.record, updated: next } : STALE;
      });

      await publishProjects(kernel);

      if (
        JSON.stringify(before.disabledMcp) !== JSON.stringify(updated.disabledMcp) ||
        JSON.stringify(before.disabledDocs) !== JSON.stringify(updated.disabledDocs)
      )
        await reloadProjectSessions(kernel, id);

      return updated;
    },
  };
}

/** Every project on the host, oldest first. */
export async function readProjects(kernel: Kernel): Promise<readonly ProjectRecord[]> {
  const found = await Promise.all(
    (await kernel.store.refs.list(PROJECTS)).map((ref) =>
      load(kernel.store, ref, decodeProjectRecord),
    ),
  );

  return found
    .flatMap((entry) => (entry === null ? [] : [entry.record]))
    .toSorted((left, right) => left.createdAt - right.createdAt);
}

export async function publishProjects(kernel: Kernel): Promise<void> {
  kernel.host.update({ projects: await readProjects(kernel) });
}

export async function requireProject(kernel: Kernel, id: ProjectId): Promise<Found<ProjectRecord>> {
  const found = await load(
    kernel.store,
    await kernel.store.refs.get(projectRef(id)),
    decodeProjectRecord,
  );

  if (found === null) throw new SdkError("unknown", `No project has the id ${id}.`);

  return found;
}

/**
 * The project a session starts in, read once so the caller can write its coordinator in the same
 * commit. A project accepts a session working in its folder or in a worktree of it, and never
 * once archived.
 */
export async function joinableProject(
  kernel: Kernel,
  id: ProjectId,
  workspace: WorkspaceId,
): Promise<Found<ProjectRecord>> {
  const found = await requireProject(kernel, id);

  if (found.record.archived)
    throw new SdkError("invalid", `Project ${found.record.name} is archived.`);

  const own = await load(
    kernel.store,
    await kernel.store.refs.get(workspaceRef(workspace)),
    decodeWorkspaceRecord,
  );

  const folder = own?.record.isolation?.source ?? workspace;

  if (folder !== found.record.workspace)
    throw new SdkError(
      "invalid",
      `Project ${found.record.name} works in another folder than this chat.`,
    );

  return found;
}

/** The write that makes `session` the coordinator of a project that has none, expecting the revision read. */
export async function coordinatorUpdate(
  kernel: Kernel,
  found: Found<ProjectRecord>,
  session: SessionId,
): Promise<RefUpdate> {
  return {
    name: projectRef(found.record.id),
    target: await put(kernel.store, "project", { ...found.record, coordinator: session }),
    expect: found.ref.revision,
  };
}

/** Rescans and reloads the project's running chats, so the MCP servers and context files it leaves out leave their prompt and tools. */
async function reloadProjectSessions(kernel: Kernel, id: ProjectId): Promise<void> {
  const sessions = [...kernel.plugins.runtimes().keys()];
  const records = await Promise.all(sessions.map((session) => readSession(kernel.store, session)));

  const chosen = new Set(
    records.flatMap((found) => (found?.record.project === id ? [found.record.id] : [])),
  );

  dropScans(kernel, (session) => chosen.has(session));
  await Promise.all([...chosen].map((session) => kernel.plugins.reload(session)));
}

/** `record` with the fields `patch` sets, or `record` itself when it sets none to a new value. */
function applyPatch<T extends object, K extends keyof T>(
  record: T,
  patch: { readonly [P in K]?: T[P] },
  keys: readonly K[],
): T {
  const changed = keys.filter(
    (key) => patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(record[key]),
  );

  if (changed.length === 0) return record;

  return Object.assign({ ...record }, Object.fromEntries(changed.map((key) => [key, patch[key]])));
}
