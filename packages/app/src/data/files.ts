import type { FileEntryView, FilesApi, WorkspaceId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { useQuery } from "@tanstack/react-query";
import { keys } from "./query-client.ts";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "./connection.ts";
import { startupReadsReleased } from "./startup.ts";

const NO_FOLDER_FILES = "Open a workspace to read its files";

export async function filesFor(workspace: WorkspaceId | undefined): Promise<FilesApi> {
  if (workspace === undefined) throw new Error(NO_FOLDER_FILES);
  const capability = await (await connected()).workspace(workspace).files();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

async function scanFiles(folder: SelectedWorkspace | undefined): Promise<readonly MentionFile[]> {
  if (folder === undefined) throw new Error(NO_FOLDER_FILES);
  await startupReadsReleased();
  const files = await filesFor(folder.id);
  const entries: MentionFile[] = [];

  for await (const frame of files.scan({ ignored: "exclude" })) {
    if (frame.kind === "entries")
      entries.push(...frame.entries.map((entry) => mentionFile(folder.path, entry)));
  }

  return entries;
}

export function mentionFilesOptions(folder: SelectedWorkspace | undefined, enabled: boolean) {
  return {
    queryKey: keys.mentionFiles(folder?.id),
    queryFn: () => scanFiles(folder),
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  } as const;
}

export function useMentionFiles(folder: SelectedWorkspace | undefined, enabled: boolean) {
  return useQuery(mentionFilesOptions(folder, enabled));
}

export const mentionFileSchema = Type.ReadonlyObject(
  Type.Object({
    kind: Type.Union([Type.Literal("file"), Type.Literal("folder")]),
    path: Type.String(),
    url: Type.String(),
    displayPath: Type.String(),
    label: Type.String(),
  }),
);

export type MentionFile = Static<typeof mentionFileSchema>;

export function mentionFile(
  root: string,
  entry: Pick<FileEntryView, "path" | "kind">,
): MentionFile {
  const kind = entry.kind === "directory" ? "folder" : "file";

  return {
    ...mentionFileAt(`${root.replace(/\/$/u, "")}/${entry.path}`, kind),
    displayPath: kind === "folder" ? `${entry.path}/` : entry.path,
  };
}

export function mentionFileAt(path: string, kind: MentionFile["kind"]): MentionFile {
  const target = kind === "folder" ? `${path}/` : path;
  const url = new URL("file://");
  url.pathname = target.replace(/[%\\\n\r\t]/gu, encodeURIComponent);
  const name = path.split("/").at(-1) ?? "";

  return {
    kind,
    path: target,
    url: url.href,
    displayPath: target,
    label: name === "" ? "/" : `${name}${kind === "folder" ? "/" : ""}`,
  };
}
