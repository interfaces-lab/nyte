import type { FolderTrust } from "@nyte-ai/sdk/client";

export function ownDecision(trust: FolderTrust, path: string): boolean | null {
  if (trust.state !== "trusted" && trust.state !== "untrusted") return null;

  return trust.by.kind === "folder" && trust.by.path === path ? trust.state === "trusted" : null;
}
