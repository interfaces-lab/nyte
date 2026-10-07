/**
 * Client preferences: per device, in localStorage, readable before first
 * paint. Machine-wide settings live in ~/.nyte/settings.json; see `host.ts`.
 *
 * Add one with an entry below. Read it with `useSetting(preferences.x)` in a
 * component or `preferences.x.get()` outside React, and give it a row on a
 * settings page. New entries take a field of a record key; the single-key
 * entries keep the layout earlier builds wrote.
 */
import { typed } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { ThemePreference } from "../bridge.ts";
import { CodeFontSchema, UiFontSchema } from "../theme/fonts.ts";
import { definePreference } from "./store.ts";
import type { Preference } from "./store.ts";

export { changeHostSettings, hostSetting } from "./host.ts";

export { useSetting } from "./store.ts";

export type { Preference, Setting } from "./store.ts";

const APPEARANCE = "nyte:appearance:v1";

const TERMINAL = "nyte:terminal:v1";

const FILES = "nyte:desktop:file-preferences:v1";

const CHANGES = "nyte:changes:v1";

const integer = (minimum: number, maximum: number) => Type.Integer({ minimum, maximum });

export const preferences = {
  startupDestination: definePreference(
    { key: "nyte:startup-destination:v1" },
    Type.Enum(["new-chat", "last-session"]),
    "new-chat",
  ),
  runningMessage: definePreference(
    { key: "nyte:running-message:v1" },
    Type.Enum(["steer", "queue"]),
    "steer",
  ),
  linkTarget: definePreference(
    { key: "nyte:link-target:v1" },
    Type.Enum(["built-in", "external"]),
    "built-in",
  ),
  confirmExternalLinks: definePreference(
    { key: "nyte:confirm-external-links:v1" },
    Type.Boolean(),
    true,
  ),
  trustedLinkHosts: definePreference(
    { key: "nyte:trusted-link-hosts:v1" },
    Type.Array(Type.String()),
    [],
  ),
  theme: definePreference(
    { key: APPEARANCE, field: "theme" },
    typed<ThemePreference>()(Type.Enum(["system", "light", "dark"])),
    "system",
  ),
  pointerCursors: definePreference(
    { key: APPEARANCE, field: "pointerCursors" },
    Type.Boolean(),
    false,
  ),
  tintHue: definePreference({ key: APPEARANCE, field: "tintHue" }, integer(0, 360), 250),
  tintIntensity: definePreference({ key: APPEARANCE, field: "tintIntensity" }, integer(0, 100), 0),
  uiFont: definePreference({ key: APPEARANCE, field: "uiFont" }, UiFontSchema, "inter"),
  codeFont: definePreference({ key: APPEARANCE, field: "codeFont" }, CodeFontSchema, "system"),
  uiFontSize: definePreference({ key: APPEARANCE, field: "uiFontSize" }, integer(12, 16), 13),
  codeFontSize: definePreference({ key: APPEARANCE, field: "codeFontSize" }, integer(11, 15), 12),
  fontSmoothing: definePreference(
    { key: APPEARANCE, field: "fontSmoothing" },
    Type.Enum(["antialiased", "auto"]),
    "antialiased",
  ),
  reduceTransparency: definePreference(
    { key: APPEARANCE, field: "reduceTransparency" },
    Type.Boolean(),
    false,
  ),
  toolCalls: definePreference(
    { key: APPEARANCE, field: "toolCalls" },
    Type.Enum(["compact", "balanced", "detailed"]),
    "compact",
  ),
  codeBlockWordWrap: definePreference(
    { key: APPEARANCE, field: "codeBlockWordWrap" },
    Type.Boolean(),
    false,
  ),
  terminalScrollback: definePreference(
    { key: TERMINAL, field: "scrollback" },
    integer(1_000, 100_000),
    10_000,
  ),
  terminalCursorBlink: definePreference(
    { key: TERMINAL, field: "cursorBlink" },
    Type.Boolean(),
    false,
  ),
  fileLineNumbers: definePreference({ key: FILES, field: "lineNumbers" }, Type.Boolean(), true),
  fileWordWrap: definePreference({ key: FILES, field: "wordWrap" }, Type.Boolean(), true),
  fileGitBlame: definePreference({ key: FILES, field: "gitBlame" }, Type.Boolean(), false),
  // Opening a file must not opt a workspace into writes or formatter execution.
  fileAutoSave: definePreference({ key: FILES, field: "autoSave" }, Type.Boolean(), false),
  fileFormatOnSave: definePreference({ key: FILES, field: "formatOnSave" }, Type.Boolean(), false),
  /** Defaults for repositories that haven't picked their own from the Changes menu. */
  changesLayout: definePreference(
    { key: CHANGES, field: "layout" },
    Type.Enum(["unified", "split"]),
    "unified",
  ),
  changesIgnoreWhitespace: definePreference(
    { key: CHANGES, field: "ignoreWhitespace" },
    Type.Boolean(),
    false,
  ),
  changesWordWrap: definePreference({ key: CHANGES, field: "wordWrap" }, Type.Boolean(), true),
} as const;

type ValueOf<P> = P extends Preference<infer T> ? T : never;

export type StartupDestination = ValueOf<typeof preferences.startupDestination>;

export type RunningMessagePreference = ValueOf<typeof preferences.runningMessage>;

export type LinkPreference = ValueOf<typeof preferences.linkTarget>;

export type ToolCallDensity = ValueOf<typeof preferences.toolCalls>;

export type FontSmoothing = ValueOf<typeof preferences.fontSmoothing>;
