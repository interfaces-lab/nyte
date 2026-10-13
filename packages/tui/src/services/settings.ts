/**
 * The terminal's own preferences, global and project: theme, keys, editor and
 * updates. Project values override global values. Model and compaction are
 * the host's; the thinking level kept here only seeds sessions the TUI creates.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { Json } from "@nyte-ai/sdk";
import { isJsonObject, toJson } from "../json.ts";
import { parseSettingsFile } from "../lib/settings-schema.ts";
import type { ResolvedSettings, SettingsFile, SettingsPatch } from "../lib/settings-schema.ts";

function defaultSettingsPath(): string {
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");

  return join(home, "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".nyte", "settings.json");
}

async function readSettings(path: string): Promise<SettingsFile> {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");

  let parsed: Json;

  try {
    parsed = toJson(JSON.parse(text));
  } catch (cause) {
    throw new Error(`Invalid JSON in ${path}`, { cause });
  }

  return parseSettingsFile(parsed, path);
}

function mergeSettings(global: SettingsFile, project: SettingsFile): ResolvedSettings {
  const resolved: ResolvedSettings = {
    autoUpdate: project.autoUpdate ?? global.autoUpdate ?? false,
    theme: project.theme ?? global.theme ?? "auto",
    copyOnSelect: project.copyOnSelect ?? global.copyOnSelect ?? process.platform !== "win32",
    scrollAcceleration: project.scrollAcceleration ?? global.scrollAcceleration ?? false,
    followUp: project.followUp ?? global.followUp ?? "steer",
  };

  const editor = project.externalEditor ?? global.externalEditor;
  const thinkingLevel = project.thinkingLevel ?? global.thinkingLevel;
  const withEditor = editor === undefined ? resolved : { ...resolved, externalEditor: editor };

  return thinkingLevel === undefined ? withEditor : { ...withEditor, thinkingLevel };
}

/**
 * Merges the patch into the file as stored, so keys this UI doesn't parse
 * survive, and replaces the file whole through a temporary sibling.
 */
async function writeSettingsPatch(path: string, patch: SettingsPatch): Promise<void> {
  const text = existsSync(path) ? await readFile(path, "utf8") : "{}";
  const current = toJson(JSON.parse(text));
  const merged = { ...(isJsonObject(current) ? current : {}), ...patch };
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Reads trusted project settings over user settings and serializes global updates. */
export class FileSettingsStore {
  private readonly globalPath: string;
  private writes = Promise.resolve();

  constructor(globalPath: string = defaultSettingsPath()) {
    this.globalPath = globalPath;
  }

  async read(cwd: string): Promise<ResolvedSettings> {
    await this.writes;

    const [global, project] = await Promise.all([
      readSettings(this.globalPath),
      readSettings(projectSettingsPath(cwd)),
    ]);

    return mergeSettings(global, project);
  }

  updateGlobal(patch: SettingsPatch): Promise<void> {
    const next = this.writes.then(async () => {
      // Parse first so a broken file still fails loudly instead of being written around.
      await readSettings(this.globalPath);
      await writeSettingsPatch(this.globalPath, patch);
    });

    this.writes = next.catch(() => undefined);

    return next;
  }
}
