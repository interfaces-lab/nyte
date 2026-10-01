import { readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { PluginSource } from "@nyte-ai/core/plugins";
import { isFileError } from "../paths.ts";

export type UnitSource = Exclude<PluginSource, "builtin" | "inline">;

export interface PluginRoot {
  readonly path: string;
  readonly source: UnitSource;
}

export interface PluginEntries {
  readonly session?: string;
  readonly tui?: string;
}

export interface PluginUnit {
  readonly id: string;
  readonly source: UnitSource;
  readonly path: string;
  readonly entries: PluginEntries;
}

export async function discoverPluginUnits(roots: readonly PluginRoot[]): Promise<PluginUnit[]> {
  const byId = new Map<string, PluginUnit>();

  for (const root of roots) {
    const names = await readdir(root.path).catch((cause: unknown) => {
      if (isFileError(cause, ["ENOENT"])) return [];
      throw cause;
    });

    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const path = resolve(root.path, name);
      if (!(await stat(path)).isDirectory()) continue;
      const session = await entry(path, "index");
      const tui = await entry(path, "tui");
      if (session === undefined && tui === undefined) continue;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
        throw new Error(`${path}: plugin id must be lowercase letters, digits, and hyphens`);
      if (name === "subagents" || name === "jobs")
        throw new Error(`${path}: plugin id is reserved for a built-in`);
      byId.set(name, {
        id: name,
        source: root.source,
        path,
        entries: {
          ...(session === undefined ? {} : { session }),
          ...(tui === undefined ? {} : { tui }),
        },
      });
    }
  }

  return [...byId.values()];
}

async function entry(directory: string, stem: string): Promise<string | undefined> {
  const entries: string[] = [];
  for (const extension of ["ts", "js"]) {
    const path = join(directory, `${stem}.${extension}`);
    const info = await stat(path).catch((cause: unknown) => {
      if (isFileError(cause, ["ENOENT"])) return undefined;
      throw cause;
    });
    if (info?.isFile()) entries.push(path);
  }
  if (entries.length > 1) throw new Error(`${directory}: keep one ${stem} entry`);
  return entries[0];
}

export async function unitDataFiles(
  directory: string,
): Promise<{ readonly files: string[]; readonly directories: string[] }> {
  const items = await readdir(directory, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  const directories = [directory];

  for (const item of items) {
    if (item.name === "node_modules" || item.parentPath.split(sep).includes("node_modules"))
      continue;
    const path = join(item.parentPath, item.name);
    if (item.isDirectory()) directories.push(path);
    else if (item.isFile() || (item.isSymbolicLink() && (await stat(path)).isFile()))
      files.push(path);
  }

  return { files, directories };
}
