import { props } from "@stylexjs/stylex";
import {
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "@nyte-ai/ui/menu";
import { useGitHub, useGitHubState } from "../chrome/github-account.ts";
import { folderPicker, handleOpenOutcome } from "../chrome/open-workspace.tsx";
import { clientActions } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import {
  useHostState,
  useVcsSnapshot,
  useWorkspaceSessionDirectory,
  useWorkspaces,
} from "../queries.ts";
import { ContextSelector } from "./context-selector.tsx";
import { contextStyles } from "./context-selector.stylex.ts";
import { EnvironmentMenu } from "./environment-menu.tsx";

const INLINE_FOLDERS = 5;

export function WorkspaceContext({ active }: { readonly active: boolean }) {
  const host = useHostState();
  const workspace = host.data.workspace;
  const workspaces = useWorkspaces();
  const vcs = useVcsSnapshot(workspace !== undefined);
  const github = useGitHubState(useGitHub());
  const repository = github.data?.repository;

  const workspaceName =
    workspace === undefined
      ? "Home"
      : repository === undefined
        ? workspace.name
        : `${repository.owner}/${repository.name}`;

  const status = vcs.data?.kind === "repository" ? vcs.data : undefined;

  const branch =
    status === undefined
      ? undefined
      : (status.branch ??
        (status.head === null ? undefined : `Detached ${status.head.slice(0, 7)}`));

  const openFolder = folderPicker();

  const directories = useWorkspaceSessionDirectory().data ?? [];
  const lastActivity = new Map<string, number>();

  for (const { workspacePath, sessions } of directories) {
    if (workspacePath === null) continue;

    for (const session of sessions)
      lastActivity.set(
        workspacePath,
        Math.max(session.lastActivityAt, lastActivity.get(workspacePath) ?? 0),
      );
  }

  const folders = [
    ...new Map(
      (workspaces.data ?? [])
        .filter(
          (candidate) =>
            candidate.available &&
            candidate.worktree === null &&
            candidate.path !== workspace?.path,
        )
        .map((candidate) => [candidate.path, candidate]),
    ).values(),
  ].toSorted(
    (left, right) => (lastActivity.get(right.path) ?? 0) - (lastActivity.get(left.path) ?? 0),
  );

  const nameCounts = new Map<string, number>();

  for (const folder of folders) nameCounts.set(folder.name, (nameCounts.get(folder.name) ?? 0) + 1);

  const workspaceItems = folders.map((folder) => (
    <MenuRadioItem
      key={folder.path}
      value={folder.path}
      icon="folder"
      meta={
        (nameCounts.get(folder.name) ?? 0) > 1
          ? folder.path.split(/[\\/]/u).filter(Boolean).at(-2)
          : undefined
      }
    >
      <span title={folder.path}>{folder.name}</span>
    </MenuRadioItem>
  ));

  return (
    <div {...props(contextStyles.row)}>
      <ContextSelector
        action={clientActions.selectWorkspace}
        value={workspaceName}
        active={active}
        footer={
          openFolder === undefined ? undefined : (
            <MenuItem icon="folder-add" onClick={openFolder}>
              Open Folder…
            </MenuItem>
          )
        }
      >
        <MenuRadioGroup
          value={workspace?.path ?? "home"}
          onValueChange={(value) => {
            if (value === "home") {
              if (workspace !== undefined) void nyte.host.closeWorkspace();

              return;
            }

            if (value !== workspace?.path)
              void nyte.host.openWorkspace({ path: value }).then(handleOpenOutcome);
          }}
        >
          <MenuRadioItem value="home" icon="folder">
            Home
          </MenuRadioItem>
          {workspace !== undefined && (
            <MenuRadioItem value={workspace.path} icon="folder">
              <span title={workspace.path}>{workspaceName}</span>
            </MenuRadioItem>
          )}
          {workspaceItems.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Recent Workspaces</MenuGroupLabel>
              {workspaceItems.slice(0, INLINE_FOLDERS)}
            </MenuGroup>
          )}
          {workspaceItems.length > INLINE_FOLDERS && (
            <MenuSub>
              <MenuSubTrigger icon="folder">More Workspaces</MenuSubTrigger>
              <MenuSubContent>{workspaceItems.slice(INLINE_FOLDERS)}</MenuSubContent>
            </MenuSub>
          )}
        </MenuRadioGroup>
      </ContextSelector>
      {branch !== undefined && (
        <span {...props(contextStyles.readout, contextStyles.controlLayout)}>
          <span {...props(contextStyles.text)} title={branch}>
            {branch}
          </span>
        </span>
      )}
      {nyte.clientSurface === "desktop" && <EnvironmentMenu active={active} />}
    </div>
  );
}
