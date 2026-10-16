import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { EnvironmentIdentity } from "@nyte-ai/schema";
import { sha256 } from "../hash.ts";

/** Returns a folder's identity from its inode and nanosecond creation time, independent of boot-assigned device numbers and its path. A rename keeps it; a replacement folder gets another identity. Without an inode or creation time, hashes the real path. An unresolved path hashes its absolute form so inspection can report it unavailable. */
export async function folderIdentity(path: string): Promise<EnvironmentIdentity> {
  const real = await realpath(path).catch(() => null);

  if (real === null) return asId<"environment-identity">(sha256(resolve(path)));
  const stats = await stat(real, { bigint: true }).catch(() => null);

  return asId<"environment-identity">(
    sha256(
      stats === null || stats.ino === 0n || stats.birthtimeNs === 0n
        ? real
        : `${stats.birthtimeNs}:${stats.ino}`,
    ),
  );
}
