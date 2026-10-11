/**
 * The terminal's own preferences, global and project: theme, keys, editor and
 * updates. Project values override global values. Model, thinking and
 * compaction are the host's: head configuration and host settings.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { Json } from "@nyte-ai/sdk";
import { isJsonObject, toJson, type JsonObject } from "./json.ts";
import { isThemeChoice, type ThemeChoice } from "./theme.ts";

interface SettingsFile {
  readonly externalEditor?: string;
  /** Install a newer release when the TUI starts, instead of only saying one exists. */
  readonly autoUpdate?: boolean;
  /** A pinned mode, or `auto` to follow the terminal. */
  readonly theme?: ThemeChoice;
  readonly copyOnSelect?: boolean;
  /** Use timing-sensitive wheel acceleration instead of the fixed three-row step. */
  readonly scrollAcceleration?: boolean;
  readonly followUp?: "steer" | "queue";
}

export interface ResolvedSettings {
  readonly externalEditor?: string;
  readonly autoUpdate: boolean;
  readonly theme: ThemeChoice;
  readonly copyOnSelect: boolean;
  readonly scrollAcceleration: boolean;
  readonly followUp: "steer" | "queue";
}

export type SettingsPatch = SettingsFile;

function defaultSettingsPath(): string {
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");

  return join(home, "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".nyte", "settings.json");
}

function isNonEmptyString(value: Json | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isBoolean(value: Json | undefined): value is boolean {
  return typeof value === "boolean";
}

function optionalString(object: JsonObject, key: string, path: string): string | undefined {
  const field = object[key];

  if (field === undefined) return undefined;

  if (!isNonEmptyString(field)) throw new Error(`${path}.${key} must be a non-empty string`);

  return field;
}

function optionalBoolean(object: JsonObject, key: string, path: string): boolean | undefined {
  const field = object[key];

  if (field === undefined) return undefined;

  if (!isBoolean(field)) throw new Error(`${path}.${key} must be a boolean`);

  return field;
}

/** Parse the complete settings file before any of it is trusted. */
export function parseSettingsFile(value: Json, path = "settings"): SettingsFile {
  // The host and other frontends keep their own keys in the same file.
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);

  let settings: SettingsFile = {};
  const externalEditor = optionalString(value, "externalEditor", path);

  if (externalEditor !== undefined) settings = { ...settings, externalEditor };

  const autoUpdate = optionalBoolean(value, "autoUpdate", path);

  if (autoUpdate !== undefined) settings = { ...settings, autoUpdate };
  const copyOnSelect = optionalBoolean(value, "copyOnSelect", path);

  if (copyOnSelect !== undefined) settings = { ...settings, copyOnSelect };
  const scrollAcceleration = optionalBoolean(value, "scrollAcceleration", path);

  if (scrollAcceleration !== undefined) settings = { ...settings, scrollAcceleration };
  const followUp = value.followUp;

  if (followUp !== undefined) {
    if (followUp !== "steer" && followUp !== "queue")
      throw new Error(`${path}.followUp must be steer or queue`);
    settings = { ...settings, followUp };
  }

  const theme = value["theme"];

  if (theme !== undefined) {
    if (!isNonEmptyString(theme) || !isThemeChoice(theme)) {
      throw new Error(`${path}.theme must be auto, dark, or light`);
    }

    settings = { ...settings, theme };
  }

  return settings;
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

  return editor === undefined ? resolved : { ...resolved, externalEditor: editor };
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
