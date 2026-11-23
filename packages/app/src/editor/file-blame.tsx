import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { FileVersion, WorkspaceId } from "@nyte-ai/sdk";
import { gitFor } from "../data/vcs.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { BlameText } from "./file-code-view.tsx";
import type { FileTab } from "./file-store.ts";

/** The status bar's Git blame for the caret's line, while the setting is on; a dirty file waits for its save. */
export function FileBlame(input: {
  readonly file: FileTab;
  readonly workspace: WorkspaceId;
  readonly version: FileVersion;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly caret: Parameters<typeof BlameText>[0]["caret"];
}): ReactElement | null {
  const { file, workspace, dirty } = input;
  const gitBlame = useSetting(preferences.fileGitBlame);

  const blame = useQuery({
    queryKey: ["files", "blame", file.path, input.version],
    queryFn: async () => (await gitFor(workspace)).blame(file.path),
    enabled: gitBlame && input.active && !dirty,
  });

  if (!gitBlame) return null;

  const blameAt = (line: number): string => {
    const blameLine = blame.data?.lines.find((entry) => entry.line === line);

    return dirty
      ? "Save the file to see up-to-date Git blame."
      : blame.isError
        ? blame.error.message
        : blame.isFetching
          ? "Loading Git blame…"
          : blameLine === undefined
            ? "No Git blame for this line."
            : `${blameLine.author} · ${new Date(blameLine.at).toLocaleDateString()} · ${blameLine.commit.slice(0, 7)}`;
  };

  return (
    <BlameText
      caret={input.caret}
      revision={file.navigationRevision}
      target={file.target}
      describe={blameAt}
    />
  );
}
