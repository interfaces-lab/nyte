import type {
  ProjectId,
  ProjectInfo,
  ProjectInput,
  ProjectPatch,
  SessionInfo,
} from "@nyte-ai/schema";
import { connected } from "./connection.ts";
import { useWatchSelect } from "./watch-store.ts";
import { hostWatch } from "./watches.ts";

const NONE: readonly ProjectInfo[] = [];

export function useProjects(): readonly ProjectInfo[] {
  return (
    useWatchSelect(hostWatch("host"), (state) => state.value?.projects, sameProjects)?.filter(
      (project) => !project.archived,
    ) ?? NONE
  );
}

export function coordinatedProject(session: SessionInfo): ProjectId | undefined {
  return session.parent === null ? session.project : undefined;
}

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
