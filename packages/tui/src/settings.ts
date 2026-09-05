/**
 * Global and project settings. Project values override global values, including
 * individual compaction fields, after the workspace has been trusted.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import type { Transport } from "@nyte-ai/ai";
import { DEFAULT_COMPACTION_SETTINGS, isThinkingLevel } from "@nyte-ai/core";
import type { CompactionSettings, ThinkingLevel } from "@nyte-ai/core";
import { toJsonValue } from "@nyte-ai/core/store";
import type { JsonValue } from "@nyte-ai/schema";
import { isJsonObject, isMissingFile, type JsonObject } from "./json.ts";
import { isThemeChoice, type ThemeChoice } from "./theme.ts";

export const TRANSPORTS = [
  "sse",
  "websocket",
  "websocket-cached",
  "auto",
] as const satisfies readonly Transport[];

function isTransport(value: string): value is Transport {
  return TRANSPORTS.some((candidate) => candidate === value);
}

interface CompactionSettingsFile {
  readonly enabled?: boolean;
  readonly reserveTokens?: number;
  readonly keepRecentTokens?: number;
}

interface SettingsFile {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: ThinkingLevel;
  readonly transport?: Transport;
  readonly externalEditor?: string;
  readonly compaction?: CompactionSettingsFile;
  /** Install a newer release when the TUI starts, instead of only saying one exists. */
  readonly autoUpdate?: boolean;
  /** A pinned mode, or `auto` to follow the terminal. */
  readonly theme?: ThemeChoice;
  readonly copyOnSelect?: boolean;
  readonly followUp?: "steer" | "queue";
}

export interface ResolvedSettings {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: ThinkingLevel;
  readonly transport: Transport;
  readonly externalEditor?: string;
  readonly compaction: CompactionSettings;
  readonly autoUpdate: boolean;
  readonly theme: ThemeChoice;
  readonly copyOnSelect: boolean;
  readonly followUp: "steer" | "queue";
}

export type SettingsPatch = SettingsFile;

const SETTINGS_KEYS = new Set([
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "transport",
  "externalEditor",
  "compaction",
  "autoUpdate",
  "theme",
  "copyOnSelect",
  "followUp",
]);
const COMPACTION_KEYS = new Set(["enabled", "reserveTokens", "keepRecentTokens"]);

function defaultSettingsPath(): string {
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
  return join(home, "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".nyte", "settings.json");
}

function isNonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

function isTokenCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function rejectUnknownKeys(object: JsonObject, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(object).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${path} has unknown property "${unknown}"`);
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

function optionalTokenCount(object: JsonObject, key: string, path: string): number | undefined {
  const field = object[key];
  if (field === undefined) return undefined;
  if (!isTokenCount(field)) throw new Error(`${path}.${key} must be a non-negative safe integer`);
  return field;
}

function parseCompaction(
  value: JsonValue | undefined,
  path: string,
): CompactionSettingsFile | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);
  rejectUnknownKeys(value, COMPACTION_KEYS, path);
  let compaction: CompactionSettingsFile = {};
  const enabled = optionalBoolean(value, "enabled", path);
  if (enabled !== undefined) compaction = { ...compaction, enabled };
  const reserveTokens = optionalTokenCount(value, "reserveTokens", path);
  if (reserveTokens !== undefined) compaction = { ...compaction, reserveTokens };
  const keepRecentTokens = optionalTokenCount(value, "keepRecentTokens", path);
  if (keepRecentTokens !== undefined) compaction = { ...compaction, keepRecentTokens };
  return compaction;
}

/** Parse the complete settings file before any of it is trusted. */
export function parseSettingsFile(value: JsonValue, path = "settings"): SettingsFile {
  if (!isJsonObject(value)) throw new Error(`${path} must be an object`);
  rejectUnknownKeys(value, SETTINGS_KEYS, path);

  let settings: SettingsFile = {};
  const defaultProvider = optionalString(value, "defaultProvider", path);
  const defaultModel = optionalString(value, "defaultModel", path);
  if (defaultModel !== undefined && defaultProvider === undefined) {
    throw new Error(`${path}.defaultModel requires ${path}.defaultProvider`);
  }
  if (defaultProvider !== undefined) settings = { ...settings, defaultProvider };
  if (defaultModel !== undefined) settings = { ...settings, defaultModel };

  const thinking = value["defaultThinkingLevel"];
  if (thinking !== undefined) {
    if (!isNonEmptyString(thinking) || !isThinkingLevel(thinking)) {
      throw new Error(`${path}.defaultThinkingLevel is not a thinking level`);
    }
    settings = { ...settings, defaultThinkingLevel: thinking };
  }

  const transport = value["transport"];
  if (transport !== undefined) {
    if (!isNonEmptyString(transport) || !isTransport(transport)) {
      throw new Error(`${path}.transport must be ${TRANSPORTS.join(", ")}`);
    }
    settings = { ...settings, transport };
  }

  const externalEditor = optionalString(value, "externalEditor", path);
  if (externalEditor !== undefined) settings = { ...settings, externalEditor };

  const compaction = parseCompaction(value["compaction"], `${path}.compaction`);
  if (compaction !== undefined) settings = { ...settings, compaction };

  const autoUpdate = optionalBoolean(value, "autoUpdate", path);
  if (autoUpdate !== undefined) settings = { ...settings, autoUpdate };
  const copyOnSelect = optionalBoolean(value, "copyOnSelect", path);
  if (copyOnSelect !== undefined) settings = { ...settings, copyOnSelect };
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
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (isMissingFile(cause)) return {};
    throw cause;
  }
  let parsed: JsonValue;
  try {
    parsed = toJsonValue(JSON.parse(text));
  } catch (cause) {
    throw new Error(`Invalid JSON in ${path}`, { cause });
  }
  return parseSettingsFile(parsed, path);
}

function mergeSettings(global: SettingsFile, project: SettingsFile): ResolvedSettings {
  const model =
    project.defaultProvider === undefined
      ? { provider: global.defaultProvider, model: global.defaultModel }
      : { provider: project.defaultProvider, model: project.defaultModel };
  let resolved: ResolvedSettings = {
    transport: project.transport ?? global.transport ?? "auto",
    compaction: {
      ...DEFAULT_COMPACTION_SETTINGS,
      ...global.compaction,
      ...project.compaction,
    },
    autoUpdate: project.autoUpdate ?? global.autoUpdate ?? false,
    theme: project.theme ?? global.theme ?? "auto",
    copyOnSelect: project.copyOnSelect ?? global.copyOnSelect ?? false,
    followUp: project.followUp ?? global.followUp ?? "steer",
  };
  if (model.provider !== undefined) resolved = { ...resolved, defaultProvider: model.provider };
  if (model.model !== undefined) resolved = { ...resolved, defaultModel: model.model };
  const thinking = project.defaultThinkingLevel ?? global.defaultThinkingLevel;
  if (thinking !== undefined) resolved = { ...resolved, defaultThinkingLevel: thinking };
  const editor = project.externalEditor ?? global.externalEditor;
  if (editor !== undefined) resolved = { ...resolved, externalEditor: editor };
  return resolved;
}

function applySettingsPatch(current: SettingsFile, patch: SettingsPatch): SettingsFile {
  const merged: SettingsFile = { ...current, ...patch };
  if (patch.compaction !== undefined) {
    return { ...merged, compaction: { ...current.compaction, ...patch.compaction } };
  }
  return merged;
}

async function writeSettings(path: string, settings: SettingsFile): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  let committed = false;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    committed = true;
  } finally {
    if (!committed) await unlink(temporaryPath).catch(() => undefined);
  }
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
      const current = await readSettings(this.globalPath);
      await writeSettings(this.globalPath, applySettingsPatch(current, patch));
    });
    this.writes = next.catch(() => undefined);
    return next;
  }
}
