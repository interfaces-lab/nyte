import type { SessionInfo } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { toast } from "@nyte-ai/ui/toast";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { formatTimeAgo } from "../components/ui.tsx";
import { errorMessage } from "../errors.ts";
import type { Setting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { useWorkspaces } from "../queries.ts";
import { connected, sessionsWatch, useWatch } from "../sdk.tsx";
import { NumberRow, SettingsRow, SettingsSection, TextRow } from "./rows.tsx";

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
        <CleanNowRow />
      </SettingsSection>
      <WorktreesSection />
    </>
  );
}

function CleanNowRow(): ReactElement {
  const clean = useMutation({
    mutationFn: async () => (await connected()).workspaces.cleanWorktrees(),
    onSuccess: (outcome) =>
      toast.add({
        type: "success",
        title:
          outcome.cleaned === 0
            ? "Nothing to clean"
            : `Cleaned ${String(outcome.cleaned)} ${outcome.cleaned === 1 ? "worktree" : "worktrees"}`,
      }),
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  return (
    <SettingsRow
      title="Run cleanup"
      description="Apply these rules now instead of at the daily check"
    >
      <Button variant="outline" loading={clean.isPending} onClick={() => clean.mutate()}>
        Clean Now
      </Button>
    </SettingsRow>
  );
}

function WorktreesSection(): ReactElement {
  const worktrees = (useWorkspaces().data ?? []).flatMap((workspace) =>
    workspace.worktree === null ? [] : [{ ...workspace, worktree: workspace.worktree }],
  );

  const sessions = useWatch(sessionsWatch("all")).value ?? [];
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
