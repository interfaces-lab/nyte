import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { envelope, trustRef } from "@nyte-ai/core/store";
import type { StoreConnection } from "@nyte-ai/core";
import { SdkError } from "@nyte-ai/schema";
import type { RefUpdate } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";

const MIGRATION = "host/migrations/legacy-folder-trust-v1";

/** `~/.nyte/workspaces.json` from before the store: a folder the user trusted has `trusted: true`; `false` only means it was opened. */
const WorkspacesFile = Type.Record(Type.String(), Type.Object({ trusted: Type.Boolean() }));

/** `trust.json` from uji and early Nyte: every folder in it was trusted. */
const TrustFile = Type.Record(Type.String(), Type.Literal(true));

/**
 * Carries the folders an older Nyte, or uji before it, was told to trust into
 * the store, once per store: the grants in `~/.nyte/workspaces.json`,
 * `~/.nyte/trust.json` and `~/.uji/trust.json` become folder trust decisions
 * where the store saved none. A folder that is gone, the home folder and the
 * folders above it are skipped: home holds the user's own files, and a grant
 * there trusted every project under it. The files are left as they are.
 */
export async function importLegacyTrust(connection: StoreConnection, home: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await connection.refs.get(MIGRATION)) !== null) return;
    const folders = await legacyFolders(home);
    const updates: RefUpdate[] = [];

    for (const path of folders) {
      const target = { kind: "local", path } as const;
      const name = await trustRef(target);

      if ((await connection.refs.get(name)) !== null) continue;
      updates.push({
        name,
        expect: "absent",
        target: await connection.objects.put(
          envelope("trust", { target, trusted: true }, Date.now()),
        ),
      });
    }

    updates.push({
      name: MIGRATION,
      expect: "absent",
      target: await connection.objects.put({ imported: folders }),
    });

    if ((await connection.refs.set(updates)).kind === "set") return;
  }

  throw new SdkError("unavailable", "Folder trust changed while Nyte was importing it.");
}

async function legacyFolders(home: string): Promise<readonly string[]> {
  const [workspaces, nyte, uji] = await Promise.all([
    readJson(join(home, ".nyte", "workspaces.json")),
    readJson(join(home, ".nyte", "trust.json")),
    readJson(join(home, ".uji", "trust.json")),
  ]);

  const granted = [
    ...(Value.Check(WorkspacesFile, workspaces)
      ? Object.entries(workspaces).flatMap(([path, row]) => (row.trusted ? [path] : []))
      : []),
    ...[nyte, uji].flatMap((file) => (Value.Check(TrustFile, file) ? Object.keys(file) : [])),
  ];

  const ownHome = await realpath(home).catch(() => home);
  const found = await Promise.all(granted.map(canonicalFolder));

  return [
    ...new Set(
      found.flatMap((path) =>
        path === null || path === ownHome || ownHome.startsWith(`${path}/`) || path === "/"
          ? []
          : [path],
      ),
    ),
  ];
}

async function canonicalFolder(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null;
  const real = await realpath(path).catch(() => null);

  if (real === null || (await stat(real).catch(() => null))?.isDirectory() !== true) return null;

  return real.replace(/\/+$/u, "");
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
