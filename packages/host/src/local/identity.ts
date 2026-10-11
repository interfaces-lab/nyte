import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { EnvironmentIdentity } from "@nyte-ai/schema";
import { sha256 } from "../hash.ts";

/** Returns a folder's identity (§41d): the SHA-256 hex of `<device>:<inode>` of its real path, so moving or renaming the folder on one filesystem keeps it, and a folder deleted and re-created at the same path gets a new one; where the stat has no inode (0), the SHA-256 of the real path. A path that does not resolve hashes its absolute form, so `inspect` can answer an unavailable folder. */
export async function folderIdentity(path: string): Promise<EnvironmentIdentity> {
  const real = await realpath(path).catch(() => null);

  if (real === null) return asId<"environment-identity">(sha256(resolve(path)));
  const stats = await stat(real, { bigint: true }).catch(() => null);

  return asId<"environment-identity">(
    sha256(stats === null || stats.ino === 0n ? real : `${stats.dev}:${stats.ino}`),
  );
}
