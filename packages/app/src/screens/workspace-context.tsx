import { props } from "@stylexjs/stylex";
import {
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
} from "@nyte-ai/ui/menu";
import { useGitHubState } from "../chrome/github-account.ts";
import { folderPicker, handleOpenOutcome } from "../chrome/open-workspace.tsx";
import { clientActions } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { useHostState, useVcsSnapshot, useWorkspaces } from "../queries.ts";
import { ContextSelector } from "./context-selector.tsx";
import { contextStyles } from "./context-selector.stylex.ts";
import { EnvironmentMenu } from "./environment-menu.tsx";

export function WorkspaceContext({ active }: { readonly active: boolean }) {
  const host = useHostState();
  const workspace = host.data?.workspace;
  const workspaces = useWorkspaces();
  const vcs = useVcsSnapshot(workspace !== undefined);
  const github = useGitHubState(nyte.host.github);
  const repository = github.data?.repository;
  const workspaceName =
    workspace === undefined
      ? "Home"
      : repository === undefined
        ? workspace.name
        : `${repository.owner}/${repository.name}`;
  const head = vcs.data?.kind === "repository" ? vcs.data.head : undefined;
  const branch =
    head === undefined
      ? undefined
      : head.kind === "detached"
        ? `Detached ${head.oid.slice(0, 7)}`
        : head.branch;
  const openFolder = folderPicker();
  const recentWorkspaces = (workspaces.data ?? []).filter(
    (candidate) => candidate.path !== workspace?.path,
  );
  const workspaceItems = recentWorkspaces.map((candidate) => (
    <MenuRadioItem
      key={candidate.path}
      value={candidate.path}
      icon="folder"
      disabled={candidate.available === false}
      disabledReason={
        candidate.available === false
          ? openFolder === undefined
            ? "Folder inaccessible"
            : "Open Folder to reconnect"
          : undefined
      }
    >
      <span title={candidate.path}>{candidate.name}</span>
    </MenuRadioItem>
  ));

  if (host.data === undefined) return null;

  return (
    <div {...props(contextStyles.row)}>
      <ContextSelector action={clientActions.selectWorkspace} value={workspaceName} active={active}>
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
            <MenuGroup label="Recent Workspaces">{workspaceItems.slice(0, 8)}</MenuGroup>
          )}
          {workspaceItems.length > 8 && (
            <MenuSubmenu label="More Workspaces" icon="folder">
              {workspaceItems.slice(8)}
            </MenuSubmenu>
          )}
        </MenuRadioGroup>
        {openFolder !== undefined && (
          <>
            <MenuSeparator />
            <MenuItem icon="folder-add" onSelect={openFolder}>
              Open Folder…
            </MenuItem>
          </>
        )}
      </ContextSelector>
      {branch !== undefined && (
        <span {...props(contextStyles.readout, contextStyles.controlLayout)}>
          <span {...props(contextStyles.text)} title={branch}>
            Agent Branch: {branch}
          </span>
        </span>
      )}
      {nyte.clientSurface === "desktop" && <EnvironmentMenu active={active} />}
    </div>
  );
}
