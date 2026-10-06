/**
 * Every setting the desktop could show, each one tied to code that already
 * decides it. `shipped` rows exist in Settings today and only get copy;
 * `wire` rows exist as a constant, a menu toggle, a file, or an env var with
 * no row; `new` rows need a small amount of new behaviour.
 *
 * `before` records the shipped description so the diff is reviewable:
 * `null` means the row had none.
 */
import type { IconName } from "@nyte-ai/ui/icon";

export type Status = "shipped" | "wire" | "new";

export type Control =
  | { readonly kind: "switch"; readonly value: boolean }
  | {
      readonly kind: "select";
      readonly options: readonly [string, ...string[]];
      readonly value: string;
      readonly wide?: boolean;
    }
  | {
      readonly kind: "steps";
      readonly options: readonly [string, ...string[]];
      readonly value: string;
    }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly min: number;
      readonly max: number;
      readonly step?: number;
    }
  | { readonly kind: "hue"; readonly value: number }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "action"; readonly label: string; readonly value: string }
  | { readonly kind: "text"; readonly placeholder: string };

interface SettingBase {
  readonly title: string;
  readonly description: string;
  readonly control: Control;
  /** Where the behaviour lives today. */
  readonly source: string;
  readonly note?: string;
  readonly platform?: "macOS" | "Desktop";
}

export type Setting =
  | (SettingBase & { readonly status: "shipped"; readonly before: string | null })
  | (SettingBase & { readonly status: "wire" | "new" });

export interface Group {
  readonly title?: string;
  readonly settings: readonly Setting[];
}

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly note?: string;
  readonly groups: readonly Group[];
}

const FILE_PREFERENCES =
  "Files panel ⋯ menu, one global value in localStorage nyte:desktop:file-preferences:v1";

const CHANGES_OPTIONS =
  "Changes ⋯ menu, remembered per repository in nyte.desktop.changes-view-options.v1. The row would set the default for repositories without one";

export const SECTIONS: readonly Section[] = [
  {
    id: "general",
    title: "General",
    icon: "settings",
    groups: [
      {
        title: "Startup",
        settings: [
          {
            status: "shipped",
            title: "Window restoration",
            before: "Choose what opens when Nyte starts",
            description: "Open a new chat, or return to the chat you had open",
            control: { kind: "select", options: ["New chat", "Last chat"], value: "New chat" },
            source: "startup-preference.ts, localStorage nyte:startup-destination:v1",
          },
          {
            status: "wire",
            title: "Download updates automatically",
            description: "Fetch new versions in the background. Nyte restarts only when you choose",
            control: { kind: "switch", value: false },
            source: "main/updates.ts sets autoUpdater.autoDownload = false",
            platform: "Desktop",
          },
        ],
      },
      {
        title: "Chat",
        settings: [
          {
            status: "shipped",
            title: "Messages while running",
            before: "Choose what Enter does while the agent is working",
            description: "What Enter does while the agent works. ⌘Enter does the other",
            control: { kind: "select", options: ["Steer", "Queue"], value: "Steer" },
            source: "running-message-preference.ts, localStorage nyte:running-message:v1",
          },
        ],
      },
      {
        title: "Links",
        settings: [
          {
            status: "shipped",
            title: "Open links in",
            before: "Applies to links in chat",
            description: "Built-in opens the page in a tab beside the chat",
            control: {
              kind: "select",
              options: ["Built-in browser", "External browser"],
              value: "Built-in browser",
            },
            source: "link-preference.ts, localStorage nyte:link-target:v1",
          },
          {
            status: "wire",
            title: "Ask before opening links",
            description: "Confirm before a chat link opens in your default browser",
            control: { kind: "switch", value: true },
            source: "external-link.ts asks for every host not yet trusted",
          },
          {
            status: "wire",
            title: "Trusted sites",
            description: "Sites you chose Always Open for. They skip the prompt",
            control: { kind: "action", label: "Clear", value: "3 sites" },
            source: "localStorage nyte:trusted-link-hosts:v1",
            note: "Nothing lists or removes these today",
          },
        ],
      },
      {
        title: "System",
        settings: [
          {
            status: "new",
            title: "Notifications",
            description:
              "Notify you when a chat finishes or asks a question while Nyte is in the background",
            control: { kind: "switch", value: true },
            source: "Electron Notification on run end and on a pending question",
            platform: "Desktop",
          },
          {
            status: "new",
            title: "Unread badge",
            description: "Show the number of unread chats on the Dock icon",
            control: { kind: "switch", value: true },
            source:
              "session-read-state.ts already tracks unread chats. Main calls app.dock.setBadge",
            platform: "macOS",
          },
          {
            status: "new",
            title: "Keep awake while running",
            description: "Stop the computer from sleeping while a chat is running",
            control: { kind: "switch", value: false },
            source: "powerSaveBlocker in main, held while any run is active",
            platform: "Desktop",
          },
        ],
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    icon: "canvas-grid",
    groups: [
      {
        settings: [
          {
            status: "shipped",
            title: "Theme",
            before: null,
            description: "Follow the system, or always use light or dark",
            control: { kind: "select", options: ["System", "Light", "Dark"], value: "System" },
            source: "theme/boot.ts, localStorage nyte:appearance:v1",
          },
          {
            status: "shipped",
            title: "Use pointer cursors",
            before: "Change the cursor to a pointer when hovering over any interactive elements",
            description: "Show a hand cursor over buttons, rows, and links",
            control: { kind: "switch", value: false },
            source: "theme/appearance.ts applyPointerCursors",
          },
        ],
      },
      {
        title: "Agent conversations",
        settings: [
          {
            status: "shipped",
            title: "Tool call density",
            before: null,
            description:
              "Compact previews the step that's running. Detailed keeps finished steps open",
            control: {
              kind: "steps",
              options: ["Compact", "Balanced", "Detailed"],
              value: "Compact",
            },
            source: "conversation/step-group-content.ts",
          },
          {
            status: "shipped",
            title: "Code block word wrap",
            before: "Wrap long lines in Agent conversation code blocks",
            description: "Wrap long lines in chat code blocks instead of scrolling sideways",
            control: { kind: "switch", value: false },
            source: "data-nyte-code-block-word-wrap on <html>",
          },
        ],
      },
      {
        title: "Colors",
        settings: [
          {
            status: "shipped",
            title: "Hue",
            before: null,
            description: "Tint backgrounds and surfaces toward one color",
            control: { kind: "hue", value: 250 },
            source: "--nyte-custom-hue",
          },
          {
            status: "shipped",
            title: "Intensity",
            before: null,
            description: "How strongly the tint shows. 0% turns it off",
            control: { kind: "percent", value: 26 },
            source: "--nyte-custom-chroma-scale",
          },
          {
            status: "shipped",
            title: "Reduce transparency",
            before: "Replace translucent surfaces with opaque backgrounds",
            description: "Replace translucent surfaces with opaque backgrounds",
            control: { kind: "switch", value: false },
            source: "theme/appearance.ts applyTransparency",
            note: 'When the system setting forces it, the row locks with no reason. Say "Turned on in System Settings" in that state',
          },
        ],
      },
      {
        title: "Typography",
        settings: [
          {
            status: "shipped",
            title: "UI font size",
            before: null,
            description: "Menus, chat, and labels, in pixels",
            control: { kind: "number", value: 13, min: 12, max: 16 },
            source: "--nyte-font-size-base",
          },
          {
            status: "shipped",
            title: "Code font size",
            before: "Code editors and diffs",
            description: "Code in chat, editors, diffs, and the terminal",
            control: { kind: "number", value: 12, min: 11, max: 15 },
            source: "--nyte-font-size-code, read by conversation styles and terminal-runtime.ts",
          },
          {
            status: "shipped",
            title: "UI font family",
            before: null,
            description: "Inter, the system font, or any font installed on this computer",
            control: {
              kind: "select",
              options: ["Inter", "System UI", "SF Pro", "IBM Plex Sans"],
              value: "Inter",
              wide: true,
            },
            source: "--nyte-font-family-sans, installed fonts from host.fonts()",
          },
          {
            status: "shipped",
            title: "Code font family",
            before: "Code editors and diffs",
            description: "Used wherever code appears, including the terminal",
            control: {
              kind: "select",
              options: ["System Mono", "JetBrains Mono", "Berkeley Mono"],
              value: "System Mono",
              wide: true,
            },
            source: "--nyte-font-family-mono",
          },
          {
            status: "shipped",
            title: "Font smoothing",
            before: "Use native macOS font anti-aliasing",
            description: "Grayscale anti-aliasing. Text renders thinner and lighter",
            control: { kind: "switch", value: true },
            source: "--nyte-font-smoothing",
            platform: "macOS",
          },
        ],
      },
    ],
  },
  {
    id: "agent",
    title: "Agent",
    icon: "agent",
    note: "Model and Reasoning move here from Providers, which keeps only sign-ins",
    groups: [
      {
        title: "New chats",
        settings: [
          {
            status: "shipped",
            title: "Model",
            before: null,
            description: "New chats start on this model. Switch per chat from the composer",
            control: {
              kind: "select",
              options: ["Claude Opus 4.5 · Anthropic", "GPT-5.2 · OpenAI"],
              value: "Claude Opus 4.5 · Anthropic",
              wide: true,
            },
            source: "~/.nyte/model-preferences.json",
            note: "Today the row only has copy when no provider is connected",
          },
          {
            status: "shipped",
            title: "Reasoning",
            before: "How long the model thinks before it answers",
            description: "How long the model thinks before it answers",
            control: { kind: "select", options: ["Off", "Low", "Medium", "High"], value: "Medium" },
            source: "~/.nyte/model-preferences.json",
          },
        ],
      },
      {
        title: "Context",
        settings: [
          {
            status: "wire",
            title: "Automatic compaction",
            description: "Summarize older turns when a chat nears the model's context limit",
            control: { kind: "switch", value: true },
            source:
              "core CompactionSettings.enabled. Desktop passes no compaction, so the default applies",
          },
          {
            status: "wire",
            title: "Recent context kept",
            description: "Tokens kept word for word when older turns are summarized",
            control: { kind: "number", value: 20_000, min: 5_000, max: 100_000, step: 5_000 },
            source: "core CompactionSettings.keepRecentTokens, default 20,000",
          },
          {
            status: "wire",
            title: "Prompt cache warming",
            description:
              "Refresh the prompt cache before it expires, only when that is expected to save money",
            control: {
              kind: "select",
              options: ["Off", "While running", "Also when idle"],
              value: "While running",
            },
            source: "~/.nyte/settings.json cacheWarming, read once when the host starts",
            note: "cacheWarming.modeChanged() already exists, so the row can apply without a restart",
          },
        ],
      },
    ],
  },
  {
    id: "editor",
    title: "Editor",
    icon: "code-brackets",
    groups: [
      {
        title: "Files",
        settings: [
          {
            status: "wire",
            title: "Line numbers",
            description: "Show a line number gutter in open files",
            control: { kind: "switch", value: true },
            source: FILE_PREFERENCES,
          },
          {
            status: "wire",
            title: "Word wrap",
            description: "Wrap long lines in open files instead of scrolling sideways",
            control: { kind: "switch", value: true },
            source: FILE_PREFERENCES,
          },
          {
            status: "wire",
            title: "Git blame",
            description: "Show the author, date, and commit message for the current line",
            control: { kind: "switch", value: false },
            source: FILE_PREFERENCES,
          },
          {
            status: "wire",
            title: "Auto save",
            description: "Save 1 second after you stop typing",
            control: { kind: "switch", value: false },
            source: FILE_PREFERENCES,
          },
          {
            status: "wire",
            title: "Format on save",
            description: "Run the workspace formatter each time a file saves",
            control: { kind: "switch", value: false },
            source: FILE_PREFERENCES,
          },
        ],
      },
      {
        title: "Changes",
        settings: [
          {
            status: "wire",
            title: "Diff layout",
            description: "Each repository can still pick its own from the Changes menu",
            control: { kind: "select", options: ["Unified", "Split"], value: "Unified" },
            source: CHANGES_OPTIONS,
          },
          {
            status: "wire",
            title: "Ignore whitespace",
            description: "Hide lines that only change whitespace",
            control: { kind: "switch", value: false },
            source: CHANGES_OPTIONS,
          },
          {
            status: "wire",
            title: "Diff word wrap",
            description: "Wrap long lines in diffs instead of scrolling sideways",
            control: { kind: "switch", value: true },
            source: CHANGES_OPTIONS,
          },
        ],
      },
      {
        title: "Terminal",
        settings: [
          {
            status: "wire",
            title: "Shell",
            description: "New terminals start it as a login shell",
            control: {
              kind: "select",
              options: ["Login shell (zsh)", "/bin/bash", "/opt/homebrew/bin/fish"],
              value: "Login shell (zsh)",
              wide: true,
            },
            source: "main/terminals.ts uses userInfo().shell and spawns it with -i -l",
            platform: "Desktop",
          },
          {
            status: "wire",
            title: "Scrollback",
            description: "Lines each terminal keeps",
            control: { kind: "number", value: 10_000, min: 1_000, max: 100_000, step: 1_000 },
            source: "workbench/terminal-runtime.ts scrollback: 10000",
          },
          {
            status: "wire",
            title: "Blinking cursor",
            description: "Blink the cursor while the terminal has focus",
            control: { kind: "switch", value: false },
            source: "workbench/terminal-runtime.ts cursorBlink: false",
          },
        ],
      },
    ],
  },
  {
    id: "browser",
    title: "Browser",
    icon: "globe",
    groups: [
      {
        title: "Built-in browser",
        settings: [
          {
            status: "wire",
            title: "Block ads and trackers",
            description: "Filter requests with EasyList and EasyPrivacy",
            control: { kind: "switch", value: true },
            source: "main/adblock.ts, always on",
            platform: "Desktop",
          },
          {
            status: "wire",
            title: "Upgrade to HTTPS",
            description: "Try https:// first for public sites. Local addresses stay on http",
            control: { kind: "switch", value: true },
            source: "main/browser-policy.ts httpsUpgrade, with plainRetry when https fails",
            platform: "Desktop",
          },
        ],
      },
      {
        title: "Agent access",
        settings: [
          {
            status: "wire",
            title: "New folders",
            description:
              "The browser is signed in as you. Read only can open and read pages, but not click or type",
            control: {
              kind: "select",
              options: ["Ask", "Full access", "Read only", "Off"],
              value: "Ask",
            },
            source: "main/browser-tools.ts asks once per folder",
            platform: "Desktop",
          },
          {
            status: "wire",
            title: "Remembered folders",
            description: "Folders that already answered. Reset to be asked again",
            control: { kind: "action", label: "Reset", value: "4 folders" },
            source: "~/.nyte/browser-access.json",
            note: "Customize shows Browser access only for the open chat",
            platform: "Desktop",
          },
        ],
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    icon: "console",
    groups: [
      {
        title: "Workspaces",
        settings: [
          {
            status: "wire",
            title: "Trusted folders",
            description:
              "Nyte runs code and reads files only in trusted folders. Subfolders inherit trust",
            control: { kind: "action", label: "Manage", value: "6 folders" },
            source: "~/.nyte/workspaces.json, granted from the trust dialog in open-workspace.tsx",
            note: "Nothing revokes trust today",
          },
        ],
      },
      {
        title: "Diagnostics",
        settings: [
          {
            status: "wire",
            title: "Trace endpoint",
            description: "Send OpenTelemetry traces of agent runs to this OTLP URL",
            control: { kind: "text", placeholder: "http://localhost:4318" },
            source: "NYTE_OTEL_ENDPOINT env var, host/src/otel.ts",
          },
        ],
      },
    ],
  },
];
