import type { GitHubRepository, GitStatus, SessionInfo } from "@nyte-ai/sdk";
import type { ClientSurface } from "../bridge.ts";
import type { RailWorkspace } from "../queries.ts";

export interface ChatFact {
  readonly kind: "repository" | "worktree" | "folder";
  readonly text: string;
  readonly detail: string | undefined;
  /** The full value a click copies, which can differ from what the line shows. */
  readonly copy: string;
}

export interface ChatCardFacts {
  readonly title: string;
  readonly facts: readonly ChatFact[];
}

export interface ChatCardSources {
  readonly session: Pick<SessionInfo, "name" | "workspace">;
  readonly workspaces: readonly Pick<RailWorkspace, "id" | "path" | "name" | "worktree">[];
  readonly git: GitStatus | undefined;
  readonly repository: Pick<GitHubRepository, "owner" | "name"> | undefined;
  readonly surface: ClientSurface;
}

const HOME = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/u;

/**
 * What a chat's hover card says, in order: the repository with its branch,
 * the worktree the chat runs in, and the folder with the machine it is on.
 * A chat outside any listed folder has only its title.
 */
export function chatCardFacts(sources: ChatCardSources): ChatCardFacts {
  const title = sources.session.name ?? "New chat";
  const workspaces = sources.workspaces;
  const workspace = workspaces.find((candidate) => candidate.id === sources.session.workspace);

  if (workspace === undefined) return { title, facts: [] };
  const git = sources.git;
  const repository = sources.repository;
  const worktree = workspace.worktree;

  const folder =
    (worktree === null
      ? undefined
      : workspaces.find((candidate) => candidate.id === worktree.source)) ?? workspace;

  const branch = (git?.kind === "repository" ? git.branch : null) ?? worktree?.branch;
  const name = repository === undefined ? folder.name : `${repository.owner}/${repository.name}`;
  const inRepository = repository !== undefined || git?.kind === "repository" || worktree !== null;

  const facts: readonly (ChatFact | false)[] = [
    inRepository && { kind: "repository", text: name, detail: branch, copy: branch ?? name },
    worktree !== null && {
      kind: "worktree",
      text: workspace.name,
      detail: "Worktree",
      copy: workspace.path,
    },
    {
      kind: "folder",
      text: folder.path.replace(HOME, "~"),
      detail: sources.surface === "desktop" ? "Local" : "Remote",
      copy: folder.path,
    },
  ];

  return { title, facts: facts.filter((fact) => fact !== false) };
}
