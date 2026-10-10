import type { EnvironmentIdentity } from "@nyte-ai/schema";

/** Returns a folder's identity: the SHA-256 hex of its real path and, where the filesystem records one (`birthtimeMs` above 0), its creation time, else of the real path alone; a path that does not resolve hashes its absolute form, so `inspect` can answer an unavailable folder. One folder answers one identity; a folder deleted and re-created at the same path answers a new one where creation times exist. */
export function folderIdentity(path: string): Promise<EnvironmentIdentity> {
  throw new Error("not implemented");
}
