import type { Json } from "@nyte-ai/sdk";
import { isJsonObject } from "@nyte-ai/schema";
import type { JsonObject } from "../json.ts";
import { THEME_CHOICES } from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";

export interface SettingsFile {
  readonly externalEditor?: string;
  readonly autoUpdate?: boolean;
  readonly theme?: ThemeChoice;
  readonly copyOnSelect?: boolean;
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

function optionalString(object: JsonObject, key: string, path: string): string | undefined {
  const field = object[key];

  if (field === undefined) return undefined;

  if (typeof field !== "string" || field.trim() === "")
    throw new Error(`${path}.${key} must be a non-empty string`);

  return field;
}

function optionalBoolean(object: JsonObject, key: string, path: string): boolean | undefined {
  const field = object[key];

  if (field === undefined) return undefined;

  if (typeof field !== "boolean") throw new Error(`${path}.${key} must be a boolean`);

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

  const theme = value.theme;

  if (theme !== undefined) {
    const choice = THEME_CHOICES.find((candidate) => candidate === theme);

    if (choice === undefined) throw new Error(`${path}.theme must be auto, dark, or light`);
    settings = { ...settings, theme: choice };
  }

  return settings;
}
