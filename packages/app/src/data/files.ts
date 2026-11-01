import type { FileDocument, FileEntryView, FilesApi, FileVersion, WorkspaceId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "./query-client.ts";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "./connection.ts";
import { startupReadsReleased } from "./startup.ts";
import { selectedWorkspaceId } from "./workspaces.ts";

const NO_FOLDER_FILES = "Open a workspace to read its files";

/** The files of the folder the window has open, for the workbench that shows it. */
export function workspaceFiles(): Promise<FilesApi> {
  return filesFor(selectedWorkspaceId());
}

/** The files of `workspace`; without one it throws. */
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

/** Every file and folder in `folder`, for mentions and citations. */
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

export function useWorkspaceFile(path: string | undefined) {
  return useQuery({
    queryKey: keys.workspaceFile(path ?? ""),
    queryFn: async () => {
      if (path === undefined) throw new Error("Select a file to open it");

      return (await workspaceFiles()).read(path, { as: "document" });
    },
    enabled: path !== undefined,
    staleTime: 1_000,
  });
}

export function useSaveWorkspaceFile() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["files", "save"],
    mutationFn: async (input: {
      readonly path: string;
      readonly contents: string;
      readonly expect?: FileVersion | "absent";
    }) =>
      (await workspaceFiles()).write(
        input.path,
        input.contents,
        input.expect === undefined ? undefined : { expect: input.expect },
      ),
    onSuccess: (outcome, input) => {
      if (outcome.kind !== "saved") return;
      client.setQueryData<FileDocument>(keys.workspaceFile(input.path), (document) =>
        document?.kind === "text"
          ? { ...document, contents: input.contents, version: outcome.version }
          : document,
      );
    },
  });
}

export const mentionFileSchema = Type.ReadonlyObject(
  Type.Object({
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
  const folder = entry.kind === "directory" ? "/" : "";
  const path = `${root.replace(/\/$/u, "")}/${entry.path}`;
  const url = new URL("file:///");
  url.pathname = `${path}${folder}`;
  const name = entry.path.split("/").at(-1) ?? entry.path;

  return {
    path: `${path}${folder}`,
    url: url.href,
    displayPath: `${entry.path}${folder}`,
    label: `${name}${folder}`,
  };
}
