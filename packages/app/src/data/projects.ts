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

export type ProjectResult =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "ready"; readonly project: ProjectInfo };

export function useProject(id: ProjectId): ProjectResult {
  return useWatchSelect(
    hostWatch("host"),
    (state): ProjectResult => {
      const projects = state.value?.projects;

      if (projects === undefined) return { kind: "loading" };
      const project = projects.find((entry) => entry.id === id && !entry.archived);

      return project === undefined ? { kind: "missing" } : { kind: "ready", project };
    },
    (left, right) => JSON.stringify(left) === JSON.stringify(right),
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
