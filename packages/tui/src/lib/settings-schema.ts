import type { Json, Thinking } from "@nyte-ai/sdk";
import { isJsonObject, type JsonObject } from "../json.ts";
import { THINKING_LEVELS } from "./constants.ts";
import { isThemeChoice, type ThemeChoice } from "./theme.ts";

export interface SettingsFile {
  readonly externalEditor?: string;
  readonly autoUpdate?: boolean;
  readonly theme?: ThemeChoice;
  readonly copyOnSelect?: boolean;
  readonly scrollAcceleration?: boolean;
  readonly followUp?: "steer" | "queue";
  readonly thinkingLevel?: Thinking;
}

export interface ResolvedSettings {
  readonly externalEditor?: string;
  readonly autoUpdate: boolean;
  readonly theme: ThemeChoice;
  readonly copyOnSelect: boolean;
  readonly scrollAcceleration: boolean;
  readonly followUp: "steer" | "queue";
  readonly thinkingLevel?: Thinking;
}

export type SettingsPatch = SettingsFile;

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

export function parseSettingsFile(value: Json, path = "settings"): SettingsFile {
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

  const thinkingLevel = value.thinkingLevel;

  if (thinkingLevel !== undefined) {
    const level = THINKING_LEVELS.find((candidate) => candidate === thinkingLevel);

    if (level === undefined)
      throw new Error(`${path}.thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
    settings = { ...settings, thinkingLevel: level };
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
