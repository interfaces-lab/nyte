import { SdkError } from "@nyte-ai/schema";
import type { ToolContent } from "@nyte-ai/schema";
import type { FilesApi } from "../contract/workspace.ts";

/**
 * Uploads `source` as a tool result's file, or, when the store refuses it as
 * too large (`SdkError("invalid")`), answers one line saying so in its place.
 */
export async function attachFile(
  files: Pick<FilesApi, "upload">,
  source: AsyncIterable<Uint8Array>,
  file: { readonly mime: string; readonly name?: string },
): Promise<ToolContent> {
  try {
    return { kind: "file", blob: await files.upload(source), ...file };
  } catch (error) {
    if (!(error instanceof SdkError) || error.code !== "invalid") throw error;

    return {
      kind: "text",
      text: `${file.name ?? "The file"} is too large to attach; read part of it instead, e.g. with head, sed -n or jq.`,
    };
  }
}
