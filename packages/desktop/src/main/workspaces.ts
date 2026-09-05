/**
 * Where the desktop's user-scoped stores live. Trust decisions and the
 * workspace registry sit in `~/.nyte` beside the TUI's, so trusting or opening
 * a folder in one client is trusting or opening it in both. Core owns both
 * stores' formats; this file only names the paths.
 */
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { access, link, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import process from "node:process";
import { WorkspaceRegistry, WorkspaceTrustStore } from "@nyte-ai/core";
import { ModelPreferencesStore } from "./model-preferences.ts";
import { errorCode } from "./errors.ts";

export function nyteHome(): string {
  return resolve(process.env["NYTE_HOME"] ?? join(homedir(), ".nyte"));
}

export function createTrustStore(): WorkspaceTrustStore {
  return new WorkspaceTrustStore(join(nyteHome(), "trust.json"));
}

export function createWorkspaceRegistry(): WorkspaceRegistry {
  return new WorkspaceRegistry(join(nyteHome(), "workspaces.json"));
}

export function createModelPreferencesStore(): ModelPreferencesStore {
  return new ModelPreferencesStore(join(nyteHome(), "model-preferences.json"));
}

/** Keep desktop history outside the project, including when the project is deleted. */
export async function projectSessionPath(cwd: string): Promise<string> {
  const key = createHash("sha256").update(cwd).digest("hex");
  const directory = join(nyteHome(), "workspaces", key);
  const path = join(directory, "sessions.db");
  try {
    await access(path);
    return path;
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const legacy = join(cwd, ".nyte", "sessions.db");
  try {
    await access(legacy);
  } catch (cause) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(errorCode(cause) ?? "")) return path;
    throw cause;
  }
  // SQLite backup includes committed WAL pages and leaves the original database intact.
  const source = new DatabaseSync(legacy, { readOnly: true });
  const temporary = join(directory, `${randomUUID()}.db`);
  try {
    await backup(source, temporary);
    await link(temporary, path).catch((cause: unknown) => {
      if (errorCode(cause) !== "EEXIST") throw cause;
    });
  } finally {
    source.close();
    await rm(temporary, { force: true });
  }
  return path;
}
