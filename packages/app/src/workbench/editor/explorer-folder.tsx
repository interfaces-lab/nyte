import { button, glyph, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Loader } from "@nyte-ai/ui/loader";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { toast } from "@nyte-ai/ui/toast";
import type { SelectedWorkspace } from "../../contract/bridge.ts";
import { nyte } from "../../contract/nyte.ts";
import { keys, queryClient } from "../../data/query-client.ts";
import { useRecentWorkspaces } from "../../data/workspaces.ts";
import { FOLLOW_BROWSE } from "../model.ts";
import type { WorkbenchBrowse, WorkbenchViewKey } from "../model.ts";
import { workbench } from "../store.ts";
import type { WorkbenchWorkspace } from "../workbench-workspace.tsx";

const INLINE_FOLDERS = 5;

const CHAT_FOLDER = "chat";

export function ExplorerFolderMenu({
  viewKey,
  chatFolder,
  browsed,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly browsed: WorkbenchWorkspace;
}): ReactElement {
  const read = (): WorkbenchBrowse => workbench.getView(viewKey).browse;
  const browse = useSyncExternalStore(workbench.subscribe, read, read);
  const recents = useRecentWorkspaces({ exclude: chatFolder?.path });
  const pick = nyte.host.pickFolder;

  const items = recents.map((folder) => (
    <MenuRadioItem key={folder.path} value={folder.id} icon="folder" meta={folder.hint}>
      <span title={folder.path}>{folder.name}</span>
    </MenuRadioItem>
  ));

  return (
    <div {...props(styles.seat)}>
      <Menu>
        <MenuTrigger
          render={
            <Button size="sm">
              <span {...props(styles.name)}>{folderLabel(browsed)}</span>
              <span {...props(styles.chevron)}>
                <Icon name="chevron-down" size="2xs" />
              </span>
            </Button>
          }
        />
        <MenuContent align="start" xstyle={styles.menu}>
          <MenuRadioGroup
            value={browse.kind === "follow" ? CHAT_FOLDER : browse.id}
            onValueChange={(value) => {
              const folder = recents.find((candidate) => candidate.id === value);

              workbench.dispatch(viewKey, {
                kind: "browse",
                root: folder === undefined ? FOLLOW_BROWSE : { kind: "workspace", id: folder.id },
              });
            }}
          >
            {chatFolder !== undefined && (
              <MenuGroup>
                <MenuGroupLabel>Chat's Folder</MenuGroupLabel>
                <MenuRadioItem value={CHAT_FOLDER} icon="folder">
                  <span title={chatFolder.path}>{chatFolder.name}</span>
                </MenuRadioItem>
              </MenuGroup>
            )}
            {items.length > 0 && (
              <MenuGroup>
                <MenuGroupLabel>Recent Workspaces</MenuGroupLabel>
                {items.slice(0, INLINE_FOLDERS)}
              </MenuGroup>
            )}
            {items.length > INLINE_FOLDERS && (
              <MenuSub>
                <MenuSubTrigger icon="folder">More Workspaces</MenuSubTrigger>
                <MenuSubContent>{items.slice(INLINE_FOLDERS)}</MenuSubContent>
              </MenuSub>
            )}
          </MenuRadioGroup>
          {(chatFolder !== undefined || items.length > 0) &&
            (pick !== undefined || browse.kind === "workspace") && <MenuSeparator />}
          {pick !== undefined && (
            <MenuItem
              icon="folder-add"
              onClick={() => void browseFolder(viewKey, chatFolder, pick)}
            >
              Open Folder…
            </MenuItem>
          )}
          {browse.kind === "workspace" && (
            <MenuItem
              icon="arrow-left"
              onClick={() => workbench.dispatch(viewKey, { kind: "browse", root: FOLLOW_BROWSE })}
            >
              Back to Chat's Folder
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}

export function ExplorerFolderState({
  viewKey,
  chatFolder,
  browsed,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly browsed: Exclude<WorkbenchWorkspace, { readonly kind: "ready" }>;
}): ReactElement {
  const pick = nyte.host.pickFolder;

  switch (browsed.kind) {
    case "loading":
      return (
        <div role="status" {...props(styles.state, styles.loading)}>
          <Loader />
          <span>Loading folder…</span>
        </div>
      );
    case "unavailable":
      return (
        <div role="status" {...props(styles.state)}>
          <span>Folder unavailable</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => workbench.dispatch(viewKey, { kind: "browse", root: FOLLOW_BROWSE })}
          >
            Back to Chat's Folder
          </Button>
        </div>
      );
    case "none":
      return (
        <div role="status" {...props(styles.state)}>
          <span>Open a folder to see its files.</span>
          {pick !== undefined && (
            <Button
              size="sm"
              variant="outline"
              icon="folder-add"
              onClick={() => void browseFolder(viewKey, chatFolder, pick)}
            >
              Open Folder…
            </Button>
          )}
        </div>
      );
    default: {
      const _exhaustive: never = browsed;

      return _exhaustive;
    }
  }
}

function folderLabel(browsed: WorkbenchWorkspace): string {
  switch (browsed.kind) {
    case "ready":
      return browsed.workspace.name;
    case "none":
      return "No folder";
    case "loading":
      return "Loading folder…";
    case "unavailable":
      return "Folder unavailable";
    default: {
      const _exhaustive: never = browsed;

      return _exhaustive;
    }
  }
}

async function browseFolder(
  viewKey: WorkbenchViewKey,
  chatFolder: SelectedWorkspace | undefined,
  pick: () => Promise<string | undefined>,
): Promise<void> {
  const path = await pick();

  if (path === undefined) return;
  const outcome = await nyte.host.registerWorkspace({ path });

  if (outcome.kind === "failed") {
    toast.add({
      type: "error",
      title: "Couldn't open folder",
      id: "workspace-open",
      description: outcome.message,
      timeout: 0,
    });

    return;
  }

  await queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true });
  workbench.dispatch(viewKey, {
    kind: "browse",
    root:
      outcome.workspace.path === chatFolder?.path
        ? FOLLOW_BROWSE
        : { kind: "workspace", id: outcome.workspace.id },
  });
}

const styles = create({
  seat: {
    display: "flex",
    flexGrow: 1,
    flexBasis: "50%",
    minWidth: 0,
    containerType: "inline-size",
  },
  name: {
    maxWidth: `calc(100cqi - 2 * ${button.paddingInlineSm} - ${button.gapSm} - ${glyph["2xs"]})`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: { display: "inline-flex", flexShrink: 0 },
  menu: { maxWidth: "min(320px, var(--available-width))" },
  state: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s3,
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  loading: { flexDirection: "row", alignItems: "center", gap: space.s2 },
});
