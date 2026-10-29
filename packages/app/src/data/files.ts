import type { FileEntryView, FilesApi, FileVersion } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, queryClient } from "./query-client.ts";
import type { HostState } from "../contract/bridge.ts";
import { connected } from "./connection.ts";
import { startupReadsReleased } from "./startup.ts";
import { selectedWorkspaceId } from "./workspaces.ts";

export async function workspaceFiles(): Promise<FilesApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its files");
  const capability = await (await connected()).workspace(id).files();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

async function scanFiles(): Promise<readonly MentionFile[]> {
  await startupReadsReleased();
  const root = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const files = await workspaceFiles();
  const entries: MentionFile[] = [];

  if (root === undefined) return entries;

  for await (const frame of files.scan({ ignored: "exclude" })) {
    if (frame.kind === "entries")
      entries.push(...frame.entries.map((entry) => mentionFile(root, entry)));
  }

  return entries;
}

export function mentionFilesOptions(enabled: boolean) {
  return {
    queryKey: keys.mentionFiles,
    queryFn: scanFiles,
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  } as const;
}

export function useMentionFiles(enabled: boolean) {
  return useQuery(mentionFilesOptions(enabled));
}

export function useWorkspaceFile(path: string | undefined) {
  return useQuery({
    queryKey: keys.workspaceFile(path ?? ""),
    queryFn: async () => {
      if (path === undefined) throw new Error("Select a file to open it");

      return (await workspaceFiles()).read(path);
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
      client.setQueryData(keys.workspaceFile(input.path), {
        kind: "text" as const,
        path: input.path,
        contents: input.contents,
        version: outcome.version,
      });
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
