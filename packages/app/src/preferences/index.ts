import { typed } from "@nyte-ai/schema/model";
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

const SIDEBAR = "nyte.desktop.sidebar.v3";

export const SIDEBAR_WIDTH = { min: 214, max: 400, step: 8 } as const;

export const CHAT_WIDTH = { min: 600, max: 1600, step: 20 } as const;

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
  chatWidth: definePreference(
    { key: APPEARANCE, field: "chatWidth" },
    integer(CHAT_WIDTH.min, CHAT_WIDTH.max),
    840,
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
  fileAutoSave: definePreference({ key: FILES, field: "autoSave" }, Type.Boolean(), false),
  fileFormatOnSave: definePreference({ key: FILES, field: "formatOnSave" }, Type.Boolean(), false),
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
  sidebarVisible: definePreference({ key: SIDEBAR, field: "visible" }, Type.Boolean(), true),
  sidebarWidth: definePreference(
    { key: SIDEBAR, field: "width" },
    integer(SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
    220,
  ),
  homeVisible: definePreference({ key: SIDEBAR, field: "homeVisible" }, Type.Boolean(), true),
} as const;

type ValueOf<P> = P extends Preference<infer T> ? T : never;

export type RunningMessagePreference = ValueOf<typeof preferences.runningMessage>;

export type ToolCallDensity = ValueOf<typeof preferences.toolCalls>;
