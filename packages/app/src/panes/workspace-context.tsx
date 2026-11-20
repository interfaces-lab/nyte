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
import { useGitHubRepository } from "../data/github.ts";
import { folderPicker, handleOpenOutcome } from "./open-workspace.tsx";
import type { OpenWorkspaceOutcome } from "../contract/bridge.ts";
import { clientActions } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { useHostState } from "../data/host.ts";
import {
  commitHostWorkspace,
  folderName,
  useHomeWorkspace,
  useRecentWorkspaces,
} from "../data/workspaces.ts";
import { ContextSelector } from "./context-selector.tsx";
import { contextStyles } from "./context-selector.stylex.ts";
import { BranchSegment } from "./branch-segment.tsx";
import { EnvironmentMenu } from "./environment-menu.tsx";

const INLINE_FOLDERS = 5;

export function WorkspaceContext({
  active,
  onChoose,
}: {
  readonly active: boolean;
  readonly onChoose: (folder: string | null) => void;
}) {
  const host = useHostState();
  const workspace = host.data.workspace;
  const home = useHomeWorkspace();
  const repository = useGitHubRepository(workspace?.id);

  const workspaceName =
    repository === undefined
      ? folderName(workspace, home)
      : `${repository.owner}/${repository.name}`;

  const open = (outcome: OpenWorkspaceOutcome): void => {
    handleOpenOutcome(outcome);

    if (outcome.kind === "opened") onChoose(outcome.workspace.path);
  };

  const openFolder = folderPicker(open);

  const folders = useRecentWorkspaces({ exclude: workspace?.path }).filter(
    (folder) => folder.id !== home,
  );

  const workspaceItems = folders.map((folder) => (
    <MenuRadioItem key={folder.path} value={folder.path} icon="folder" meta={folder.hint}>
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
          value={workspace === undefined || workspace.id === home ? "home" : workspace.path}
          onValueChange={(value) => {
            if (value === "home") {
              if (workspace !== undefined) commitHostWorkspace(undefined);
              onChoose(null);

              return;
            }

            if (value !== workspace?.path) void nyte.host.openWorkspace({ path: value }).then(open);
          }}
        >
          <MenuRadioItem value="home" icon="folder">
            {folderName(undefined, home)}
          </MenuRadioItem>
          {workspace !== undefined && workspace.id !== home && (
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
      {workspace !== undefined && <BranchSegment workspace={workspace.id} switchable size="md" />}
      {nyte.clientSurface === "desktop" && <EnvironmentMenu active={active} size="md" />}
    </div>
  );
}
