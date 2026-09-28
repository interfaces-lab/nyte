/**
 * A plugin unit is a file or directory under a plugin root with one id and up
 * to three entries: `index.ts` (session, runs in the host process), `tui.ts`,
 * and `desktop.tsx`. A later root replaces a unit with the same id whole,
 * keeping the earlier position. Everything else in a unit directory belongs to
 * it: helpers any entry imports and data files that count toward its version.
 */
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import type { PluginSource } from "@nyte-ai/core/plugins";

export type UnitSource = Exclude<PluginSource, "builtin" | "inline">;

export interface PluginRoot {
  readonly path: string;
  readonly source: UnitSource;
}

export interface PluginEntries {
  readonly session?: string;
  readonly tui?: string;
  readonly desktop?: string;
}

export interface PluginUnit {
  readonly id: string;
  readonly source: UnitSource;
  /** The file for a file unit, the directory for a directory unit. */
  readonly path: string;
  readonly entries: PluginEntries;
}

const SESSION_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

const UI_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

const CODE_EXTENSIONS = new Set([...UI_EXTENSIONS, ".mts", ".mjs", ".cts", ".cjs"]);

export async function discoverPluginUnits(roots: readonly PluginRoot[]): Promise<PluginUnit[]> {
  const byId = new Map<string, PluginUnit>();

  for (const root of roots) {
    for (const unit of await unitsIn(root)) byId.set(unit.id, unit);
  }

  return [...byId.values()];
}

async function unitsIn(root: PluginRoot): Promise<PluginUnit[]> {
  const names = await readdir(root.path).catch(() => []);
  const units: PluginUnit[] = [];

  for (const name of names.sort()) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const path = join(root.path, name);
    const info = await stat(path).catch(() => undefined);

    if (info === undefined) continue;

    if (info.isFile()) {
      if (!SESSION_EXTENSIONS.includes(extname(name))) continue;
      const id = basename(name, extname(name));
      units.push({ id, source: root.source, path, entries: { session: path } });
      continue;
    }

    if (!info.isDirectory()) continue;

    const entries: PluginEntries = {
      ...(await entry(path, "index", SESSION_EXTENSIONS).then((session) =>
        session === undefined ? {} : { session },
      )),
      ...(await entry(path, "tui", UI_EXTENSIONS).then((tui) => (tui === undefined ? {} : { tui }))),
      ...(await entry(path, "desktop", UI_EXTENSIONS).then((desktop) =>
        desktop === undefined ? {} : { desktop },
      )),
    };

    if (Object.keys(entries).length === 0) continue;
    units.push({ id: name, source: root.source, path, entries });
  }

  return units;
}

async function entry(
  directory: string,
  stem: string,
  extensions: readonly string[],
): Promise<string | undefined> {
  for (const extension of extensions) {
    const candidate = join(directory, `${stem}${extension}`);

    if ((await stat(candidate).catch(() => undefined))?.isFile()) return candidate;
  }

  return undefined;
}

/**
 * The files of a directory unit that no import graph reaches but whose bytes
 * still belong to the unit: a prompt, a JSON table. Directories come back too,
 * so an added file changes a listing digest. `node_modules` never counts.
 */
export async function unitDataFiles(
  unit: PluginUnit,
): Promise<{ readonly files: string[]; readonly directories: string[] }> {
  if (unit.entries.session === unit.path) return { files: [], directories: [] };
  const items = await readdir(unit.path, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  const directories: string[] = [unit.path];

  for (const item of items) {
    if (item.name === "node_modules" || item.parentPath.split(sep).includes("node_modules"))
      continue;
    const path = join(item.parentPath, item.name);

    if (item.isDirectory()) directories.push(path);
    else if (item.isFile() && !CODE_EXTENSIONS.has(extname(item.name))) files.push(path);
  }

  return { files, directories };
}
