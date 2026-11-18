import type { WorkspaceId } from "@nyte-ai/schema";
import type { LanguageApi } from "@nyte-ai/sdk";
import { connected } from "./connection.ts";

export async function languageFor(workspace: WorkspaceId): Promise<LanguageApi> {
  const capability = await (await connected()).workspace(workspace).language();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}
