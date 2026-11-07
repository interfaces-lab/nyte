import type { ProjectId, ProjectInfo, ProjectInput, ProjectPatch } from "@nyte-ai/schema";
import { connected } from "./connection.ts";
import { useWatchSelect } from "./watch-store.ts";
import { hostWatch } from "./watches.ts";

const NONE: readonly ProjectInfo[] = [];

/** The host's projects that aren't archived, oldest first; none until the host view arrives. */
export function useProjects(): readonly ProjectInfo[] {
  return (
    useWatchSelect(hostWatch("host"), (state) => state.value?.projects, sameProjects)?.filter(
      (project) => !project.archived,
    ) ?? NONE
  );
}

/** The project a host view lists under `id`, read outside React. */
export function findProject(id: ProjectId): ProjectInfo | undefined {
  return hostWatch("host")
    .getState()
    .value?.projects.find((project) => project.id === id);
}

export async function createProject(input: ProjectInput): Promise<ProjectInfo> {
  return (await connected()).projects.create(input);
}

export async function updateProject(id: ProjectId, patch: ProjectPatch): Promise<ProjectInfo> {
  return (await connected()).project(id).update(patch);
}

function sameProjects(
  left: readonly ProjectInfo[] | undefined,
  right: readonly ProjectInfo[] | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
