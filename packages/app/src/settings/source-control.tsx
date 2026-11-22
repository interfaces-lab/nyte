import type { SessionInfo } from "@nyte-ai/sdk";
import { useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { formatTimeAgo } from "../lib/format.ts";
import type { Setting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { useWorkspaces } from "../data/workspaces.ts";
import { sessionList } from "../data/directory.ts";
import { useWatch } from "../data/watch-store.ts";
import { NumberRow, SettingsRow, SettingsSection, TextRow } from "../settings-rows/rows.tsx";
import { StorageSection } from "./storage-cleanup.tsx";

const branchPrefix = pluginSetting("worktrees.branchPrefix", Type.String());

const branchPrefixRow: Setting<string | null> = {
  ...branchPrefix,
  get: () => {
    const value = branchPrefix.get();

    return value === "" ? null : value;
  },
  set: (value) => branchPrefix.set(value ?? ""),
};

export function SourceControlSettings(): ReactElement {
  return (
    <>
      <SettingsSection title="Branches">
        <TextRow
          setting={branchPrefixRow}
          title="Branch prefix"
          description="Starts the name of each new worktree branch, such as nyte/ or your name"
          placeholder="nyte/"
        />
      </SettingsSection>
      <SettingsSection
        title="Worktree cleanup"
        description="Deletes dependency and build folders, such as node_modules, from worktrees you aren't using. Files and edits stay, and a running chat is never cleaned"
      >
        <NumberRow
          setting={pluginSetting("worktrees.idleDays", Type.Integer())}
          title="Idle days"
          description="Clean a worktree once its chat has been idle this long. 0 turns this off"
          min={0}
          max={365}
        />
        <NumberRow
          setting={pluginSetting("worktrees.maxCount", Type.Integer())}
          title="Max worktrees"
          description="Clean the least recently used worktrees beyond this many. 0 turns this off"
          min={0}
          max={500}
        />
      </SettingsSection>
      <StorageSection />
      <WorktreesSection />
    </>
  );
}

function WorktreesSection(): ReactElement {
  const worktrees = (useWorkspaces().data ?? []).flatMap((workspace) =>
    workspace.worktree === null ? [] : [{ ...workspace, worktree: workspace.worktree }],
  );

  const sessions = useWatch(sessionList("all")).value ?? [];
  const now = useState(Date.now)[0];

  const rows = worktrees
    .map((workspace) => {
      const chats = sessions.filter((session) => session.workspace === workspace.id);

      const latest = chats.reduce<SessionInfo | null>(
        (best, session) =>
          best === null || session.lastActivityAt > best.lastActivityAt ? session : best,
        null,
      );

      return { workspace, latest };
    })
    .toSorted((a, b) => (b.latest?.lastActivityAt ?? 0) - (a.latest?.lastActivityAt ?? 0));

  return (
    <SettingsSection title="Nyte worktrees">
      {rows.length === 0 ? (
        <SettingsRow title="No Nyte worktrees on this machine">{null}</SettingsRow>
      ) : (
        rows.map((row) => (
          <SettingsRow
            key={row.workspace.id}
            title={row.latest?.name ?? row.workspace.worktree.branch}
            description={
              row.latest === null
                ? row.workspace.worktree.branch
                : `${row.workspace.worktree.branch} · last used ${formatTimeAgo(row.latest.lastActivityAt, now)}`
            }
          >
            {null}
          </SettingsRow>
        ))
      )}
    </SettingsSection>
  );
}
