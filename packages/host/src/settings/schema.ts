/**
 * ~/.nyte/settings.json, shared by every Nyte frontend on this machine. Keys
 * every host reads sit at the top level and keep the names the terminal UI
 * already writes; desktop-only keys sit under `desktop`. Readers ignore keys
 * they don't know and fall back per key on a bad value.
 */
import { DEFAULT_COMPACTION_SETTINGS } from "@nyte-ai/core";
import type { CacheWarmingMode, CompactionSettings, WorkspaceTrustMode } from "@nyte-ai/core";
import { typed } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

const tokenCount = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** Null is the built-in choice: the login shell, or no trace export. */
const optionalText = Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]);

export const HostSettingsSchema = Type.Object({
  cacheWarming: typed<CacheWarmingMode>()(Type.Enum(["off", "streaming", "idle"])),
  autoCompaction: Type.Boolean(),
  compactionKeepRecentTokens: tokenCount,
  /** No row. Kept so the desktop honours what terminal UI users already set. */
  compactionReserveTokens: tokenCount,
  traceEndpoint: optionalText,
  workspaceTrust: typed<WorkspaceTrustMode>()(Type.Enum(["ask", "always", "never"])),
  notifications: Type.Boolean(),
  unreadBadge: Type.Boolean(),
  keepAwake: Type.Boolean(),
  terminalShell: optionalText,
  blockAds: Type.Boolean(),
  /** Hostnames where the shield is paused. A parent domain covers its subdomains. */
  adblockAllowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 })),
  upgradeToHttps: Type.Boolean(),
  /** What a folder with no remembered answer gets. `ask` keeps the gate. */
  browserAccess: Type.Enum(["ask", "full", "read", "off"]),
});

export type HostSettings = Static<typeof HostSettingsSchema>;

export type HostSettingKey = keyof HostSettings;

export type HostSettingsPatch = Partial<HostSettings>;

/** The `host.settings.set` input: any subset of keys. No defaults, so a patch never grows into a full overwrite. */
export const HostSettingsPatchSchema = Type.Partial(HostSettingsSchema, {
  additionalProperties: false,
});

/** A top-level key, or one field of the object at that key. */
type Slot = readonly [key: string] | readonly [key: string, field: string];

/**
 * Where each setting lives in the file and what it reads as when missing or
 * bad. Checked against the schema: a key in one list and not the other fails
 * the build.
 */
const LAYOUT = {
  cacheWarming: { slot: ["cacheWarming"], fallback: "streaming" },
  autoCompaction: {
    slot: ["compaction", "enabled"],
    fallback: DEFAULT_COMPACTION_SETTINGS.enabled,
  },
  compactionKeepRecentTokens: {
    slot: ["compaction", "keepRecentTokens"],
    fallback: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
  },
  compactionReserveTokens: {
    slot: ["compaction", "reserveTokens"],
    fallback: DEFAULT_COMPACTION_SETTINGS.reserveTokens,
  },
  traceEndpoint: { slot: ["traceEndpoint"], fallback: null },
  workspaceTrust: { slot: ["workspaceTrust"], fallback: "ask" },
  notifications: { slot: ["desktop", "notifications"], fallback: true },
  unreadBadge: { slot: ["desktop", "unreadBadge"], fallback: true },
  keepAwake: { slot: ["desktop", "keepAwake"], fallback: false },
  terminalShell: { slot: ["desktop", "terminalShell"], fallback: null },
  blockAds: { slot: ["desktop", "blockAds"], fallback: true },
  adblockAllowedHosts: { slot: ["desktop", "adblockAllowedHosts"], fallback: [] },
  upgradeToHttps: { slot: ["desktop", "upgradeToHttps"], fallback: true },
  browserAccess: { slot: ["desktop", "browserAccess"], fallback: "ask" },
} as const satisfies {
  readonly [K in HostSettingKey]: { readonly slot: Slot; readonly fallback: HostSettings[K] };
};

export type SettingsFileObject = Readonly<Record<string, unknown>>;

const FileObjectSchema = Type.Record(Type.String(), Type.Unknown());

export function settingsFileObject(value: unknown): SettingsFileObject {
  return Value.Check(FileObjectSchema, value) ? value : {};
}

function valueAt(object: SettingsFileObject, slot: Slot): unknown {
  const [key, field] = slot;
  const top = object[key];

  if (field === undefined) return top;

  return Value.Check(FileObjectSchema, top) ? top[field] : undefined;
}

/** Never throws: anything that isn't an object reads as every default. */
export function decodeHostSettings(file: unknown): HostSettings {
  const object = settingsFileObject(file);

  const properties: Readonly<Record<string, TSchema>> = HostSettingsSchema.properties;
  const layout: Readonly<Record<string, { readonly slot: Slot; readonly fallback: unknown }>> =
    LAYOUT;

  const flat: Record<string, unknown> = {};

  for (const [name, { slot, fallback }] of Object.entries(layout)) {
    const stored = valueAt(object, slot);
    const schema = properties[name];
    flat[name] =
      stored !== undefined && schema !== undefined && Value.Check(schema, stored)
        ? stored
        : fallback;
  }

  if (Value.Check(HostSettingsSchema, flat)) return flat;

  throw new Error("A default in LAYOUT fails HostSettingsSchema");
}

/** The file object with each patched setting at its slot. Every other key, known or not, stays. */
export function applyHostSettingsPatch(
  file: SettingsFileObject,
  patch: HostSettingsPatch,
): SettingsFileObject {
  const values: Readonly<Record<string, unknown>> = patch;
  const layout: Readonly<Record<string, { readonly slot: Slot }>> = LAYOUT;
  const next: Record<string, unknown> = { ...file };

  for (const [name, { slot }] of Object.entries(layout)) {
    if (!Object.hasOwn(values, name)) continue;
    const [key, field] = slot;

    if (field === undefined) {
      next[key] = values[name];
      continue;
    }

    next[key] = { ...settingsFileObject(next[key]), [field]: values[name] };
  }

  return next;
}

export function compactionSettings(settings: HostSettings): CompactionSettings {
  return {
    enabled: settings.autoCompaction,
    reserveTokens: settings.compactionReserveTokens,
    keepRecentTokens: settings.compactionKeepRecentTokens,
  };
}

/** The terminal UI's lenient decoder, answered by the schema. */
export function cacheWarmingMode(value: unknown): CacheWarmingMode {
  return decodeHostSettings({ cacheWarming: value }).cacheWarming;
}
