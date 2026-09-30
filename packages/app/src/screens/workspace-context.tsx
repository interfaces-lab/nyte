import { props } from "@stylexjs/stylex";
import { Hint } from "@nyte-ai/ui/tooltip";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { useGitHubState } from "../chrome/github-account.ts";
import { folderPicker, handleOpenOutcome } from "../chrome/open-workspace.tsx";
import { clientActions } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { useHostState, useVcsSnapshot, useWorkspaces } from "../queries.ts";
import { ContextHint, ContextSelector } from "./context-selector.tsx";
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
          {(workspaces.data ?? [])
            .filter((candidate) => candidate.path !== workspace?.path)
            .map((candidate) => (
              <MenuRadioItem
                key={candidate.path}
                value={candidate.path}
                icon="folder"
                disabled={candidate.available === false}
                meta={candidate.available === false ? "Unavailable" : undefined}
              >
                <span title={candidate.path}>{candidate.name}</span>
              </MenuRadioItem>
            ))}
        </MenuRadioGroup>
        {openFolder !== undefined && (
          <>
            <MenuSeparator />
            <MenuItem icon="folder-add" onSelect={openFolder}>
              Open folder…
            </MenuItem>
          </>
        )}
      </ContextSelector>
      {branch !== undefined && (
        <Hint
          side="top"
          xstyle={contextStyles.hint}
          content={<ContextHint label="Agent Branch" value={branch} />}
          trigger={
            <span {...props(contextStyles.readout, contextStyles.controlLayout)}>
              <span {...props(contextStyles.text)}>{branch}</span>
            </span>
          }
        />
      )}
      {nyte.clientSurface === "desktop" && <EnvironmentMenu active={active} />}
    </div>
  );
}
