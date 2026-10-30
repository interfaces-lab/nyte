import type { GitHubRepository, GitStatus } from "@nyte-ai/sdk";
import type { ClientSurface } from "../contract/bridge.ts";
import type { Chat } from "../chats/index.ts";

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
  readonly chat: Pick<Chat, "title" | "location">;
  readonly git: GitStatus | undefined;
  readonly repository: Pick<GitHubRepository, "owner" | "name"> | undefined;
  readonly surface: ClientSurface;
}

const HOME = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/u;

export function chatCardFacts(sources: ChatCardSources): ChatCardFacts {
  const title = sources.chat.title;
  const location = sources.chat.location;

  if (location.kind !== "folder") return { title, facts: [] };
  const git = sources.git;
  const repository = sources.repository;
  const worktree = location.worktree;
  const folder = worktree?.source ?? location;
  const branch = (git?.kind === "repository" ? git.branch : null) ?? worktree?.branch;
  const name = repository === undefined ? folder.name : `${repository.owner}/${repository.name}`;
  const inRepository = repository !== undefined || git?.kind === "repository" || worktree !== null;

  const facts: readonly (ChatFact | false)[] = [
    inRepository && { kind: "repository", text: name, detail: branch, copy: branch ?? name },
    worktree !== null && {
      kind: "worktree",
      text: location.name,
      detail: "Worktree",
      copy: location.path,
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
