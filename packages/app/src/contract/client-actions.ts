import type { Json } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { TSchema } from "typebox";

/**
 * Every action the app runs by name. A key, a menu item, the command palette, the CLI and a plugin
 * all name one of these; `APP_ACTIONS` says what each takes.
 */
export type AppAction =
  | "chat.new"
  | "tab.new"
  | "tab.close"
  | "tab.reopen"
  | "folder.open"
  | "home.open"
  | "settings.open"
  | "customize.open"
  | "search.toggle"
  | "sidebar.toggle"
  | "workbench.toggle"
  | "terminal.toggle"
  | "terminal.new"
  | "browser.new"
  | "pane.split"
  | "pane.focus.next"
  | "markdown.source.toggle"
  | "window.reload"
  | "app.open"
  | "history.back"
  | "history.forward";

const NOTHING = Type.Object({}, { additionalProperties: false });

/** What each action does and the input it takes, as a caller outside the app reads it. */
export const APP_ACTIONS = {
  "chat.new": { summary: "Starts a new chat.", input: NOTHING },
  "tab.new": { summary: "Opens a new tab.", input: NOTHING },
  "tab.close": {
    summary:
      "Closes Settings when it is open, else the file or workbench tab in focus, else the active tab.",
    input: NOTHING,
  },
  "tab.reopen": { summary: "Reopens the tab closed last.", input: NOTHING },
  "folder.open": { summary: "Shows the folder picker.", input: NOTHING },
  "home.open": { summary: "Switches to Home, the chats outside any folder.", input: NOTHING },
  "settings.open": {
    summary: "Opens Settings, on `page` when given: one of its pages or a page plugins named.",
    input: Type.Object({ page: Type.Optional(Type.String()) }, { additionalProperties: false }),
  },
  "customize.open": { summary: "Opens Customize.", input: NOTHING },
  "search.toggle": { summary: "Shows or hides search.", input: NOTHING },
  "sidebar.toggle": { summary: "Shows or hides the sidebar.", input: NOTHING },
  "workbench.toggle": { summary: "Shows or hides the workbench.", input: NOTHING },
  "terminal.toggle": {
    summary: "Shows the terminal, or hides it when it is in front.",
    input: NOTHING,
  },
  "terminal.new": { summary: "Opens a new terminal.", input: NOTHING },
  "browser.new": { summary: "Opens a new browser tab.", input: NOTHING },
  "pane.split": {
    summary: "Splits the focused pane to the right or down.",
    input: Type.Object(
      { direction: Type.Union([Type.Literal("right"), Type.Literal("down")]) },
      { additionalProperties: false },
    ),
  },
  "pane.focus.next": { summary: "Moves focus to the next pane.", input: NOTHING },
  "markdown.source.toggle": {
    summary: "Switches the focused Markdown file between its source and its rendering.",
    input: NOTHING,
  },
  "window.reload": { summary: "Reloads the window.", input: NOTHING },
  "app.open": {
    summary: "Switches to Nyte, Code or Studio, or back to the app used last.",
    input: Type.Object(
      {
        app: Type.Union([
          Type.Literal("nyte"),
          Type.Literal("code"),
          Type.Literal("studio"),
          Type.Literal("last"),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  "history.back": { summary: "Steps back through the Editor's history.", input: NOTHING },
  "history.forward": { summary: "Steps forward through the Editor's history.", input: NOTHING },
} satisfies Record<AppAction, { readonly summary: string; readonly input: TSchema }>;

export function namesAppAction(name: string): name is AppAction {
  return Object.hasOwn(APP_ACTIONS, name);
}

type ActionChord =
  | "primary"
  | "primary-shift"
  | "primary-alt"
  | "control"
  | "control-shift"
  | "none";

type ClientStage = "workspace" | "customize" | "project" | "settings";

export interface ClientCapabilities {
  readonly browser: boolean;
}

export function clientCapabilities(host: { readonly browser?: unknown }): ClientCapabilities {
  return { browser: host.browser !== undefined };
}

interface ActionDetails {
  readonly id: string;
  readonly label: string;
  /** The action this entry runs, with `input`. An entry without one is run by the control that shows it. */
  readonly action?: AppAction;
  readonly input?: Json;
  readonly scope: "window" | "workspace" | "outside-settings";
  readonly capability?: keyof ClientCapabilities;
  readonly palette?: {
    readonly keywords: string;
    readonly group: "actions" | "settings";
  };
  /** The entry runs before the focused element sees the key, so an editor or a terminal can't take it first. */
  readonly early?: true;
}

type ActionDefinition = ActionDetails &
  (
    | { readonly key: string; readonly chord: ActionChord }
    | { readonly key?: never; readonly chord?: never }
  );

export const clientActions = {
  newChat: {
    id: "new-chat",
    action: "chat.new",
    label: "New Chat",
    key: "n",
    chord: "primary",
    scope: "window",
    palette: { keywords: "start create conversation session", group: "actions" },
  },
  newTab: {
    id: "new-tab",
    action: "tab.new",
    label: "New Tab",
    key: "t",
    chord: "primary",
    scope: "outside-settings",
  },
  closeTab: {
    id: "close-tab",
    action: "tab.close",
    label: "Close Tab",
    key: "w",
    chord: "primary",
    scope: "outside-settings",
  },
  reopenTab: {
    id: "reopen-tab",
    action: "tab.reopen",
    label: "Reopen Closed Tab",
    key: "t",
    chord: "primary-shift",
    scope: "outside-settings",
  },
  selectWorkspace: {
    id: "select-workspace",
    label: "Select Workspace",
    key: ".",
    chord: "primary",
    scope: "workspace",
  },
  selectEnvironment: {
    id: "select-environment",
    label: "Select Environment",
    key: ".",
    chord: "primary-shift",
    scope: "workspace",
  },
  selectModel: {
    id: "select-model",
    label: "Select Model",
    key: "/",
    chord: "primary",
    scope: "workspace",
  },
  openFolder: {
    id: "open-folder",
    action: "folder.open",
    label: "Open Folder…",
    key: "o",
    chord: "primary",
    scope: "window",
    palette: {
      keywords: "workspace project directory choose",
      group: "actions",
    },
  },
  openHome: {
    id: "open-home",
    action: "home.open",
    label: "Open Home",
    scope: "window",
    palette: { keywords: "workspace projectless activate", group: "actions" },
  },
  generalSettings: {
    id: "general-settings",
    action: "settings.open",
    input: { page: "general" },
    label: "General Settings",
    scope: "window",
    palette: { keywords: "preferences configuration", group: "settings" },
  },
  appearanceSettings: {
    id: "appearance-settings",
    action: "settings.open",
    input: { page: "appearance" },
    label: "Appearance",
    scope: "window",
    palette: { keywords: "theme color interface", group: "settings" },
  },
  modelSettings: {
    id: "model-settings",
    action: "settings.open",
    input: { page: "providers" },
    label: "Providers",
    scope: "window",
    palette: {
      keywords: "providers api key sign in anthropic openai default reasoning",
      group: "settings",
    },
  },
  profileSettings: {
    id: "profile-settings",
    action: "settings.open",
    input: { page: "profile" },
    label: "Profile",
    scope: "window",
    palette: {
      keywords: "account github nyte email login sign in remote access",
      group: "settings",
    },
  },
  customize: {
    id: "customize-settings",
    action: "customize.open",
    label: "Customize",
    scope: "window",
    palette: { keywords: "agents skills rules mcp", group: "settings" },
  },
  reloadWindow: {
    id: "reload-window",
    action: "window.reload",
    label: "Reload Window",
    key: "r",
    chord: "primary-shift",
    scope: "window",
    palette: { keywords: "refresh restart", group: "actions" },
  },
  search: {
    id: "search",
    action: "search.toggle",
    label: "Search",
    key: "k",
    chord: "primary",
    scope: "window",
  },
  settings: {
    id: "settings",
    action: "settings.open",
    label: "Settings…",
    key: ",",
    chord: "primary",
    scope: "outside-settings",
  },
  sidebar: {
    id: "sidebar",
    action: "sidebar.toggle",
    label: "Toggle Sidebar",
    key: "b",
    chord: "primary",
    scope: "window",
  },
  splitRight: {
    id: "split-right",
    action: "pane.split",
    input: { direction: "right" },
    label: "Split Right",
    key: "d",
    chord: "primary",
    scope: "workspace",
  },
  splitDown: {
    id: "split-down",
    action: "pane.split",
    input: { direction: "down" },
    label: "Split Down",
    key: "d",
    chord: "primary-shift",
    scope: "workspace",
  },
  workbench: {
    id: "workbench",
    action: "workbench.toggle",
    label: "Toggle Workbench",
    key: "b",
    chord: "primary-alt",
    scope: "workspace",
  },
  terminal: {
    id: "terminal",
    action: "terminal.toggle",
    label: "Toggle Terminal",
    key: "`",
    chord: "control",
    scope: "workspace",
  },
  newTerminal: {
    id: "new-terminal",
    action: "terminal.new",
    label: "New Terminal",
    key: "`",
    chord: "control-shift",
    scope: "workspace",
  },
  newBrowser: {
    id: "new-browser",
    action: "browser.new",
    label: "New Browser",
    scope: "workspace",
    capability: "browser",
  },
  markdownSource: {
    id: "markdown-source",
    action: "markdown.source.toggle",
    label: "Toggle Markdown Source",
    key: "v",
    chord: "primary-shift",
    scope: "workspace",
  },
  focusPane: {
    id: "focus-pane",
    action: "pane.focus.next",
    label: "Focus Next Pane",
    key: "f6",
    chord: "none",
    scope: "workspace",
  },
  openNyte: {
    id: "open-nyte",
    action: "app.open",
    input: { app: "nyte" },
    label: "Nyte",
    key: "1",
    chord: "control-shift",
    scope: "window",
    early: true,
  },
  openCode: {
    id: "open-code",
    action: "app.open",
    input: { app: "code" },
    label: "Code",
    key: "2",
    chord: "control-shift",
    scope: "window",
    early: true,
  },
  openStudio: {
    id: "open-studio",
    action: "app.open",
    input: { app: "studio" },
    label: "Studio",
    key: "3",
    chord: "control-shift",
    scope: "window",
    early: true,
  },
  flipApp: {
    id: "flip-app",
    action: "app.open",
    input: { app: "last" },
    label: "Switch to Last App",
    key: "space",
    chord: "control-shift",
    scope: "window",
    early: true,
  },
  goBack: {
    id: "go-back",
    action: "history.back",
    label: "Back",
    key: "[",
    chord: "primary",
    scope: "workspace",
    early: true,
  },
  goForward: {
    id: "go-forward",
    action: "history.forward",
    label: "Forward",
    key: "]",
    chord: "primary",
    scope: "workspace",
    early: true,
  },
} as const satisfies Record<string, ActionDefinition>;

/** An entry that runs a named action, as a menu item or a key does. */
export type RunnableAction = ActionDefinition & { readonly action: AppAction };

export function clientActionAvailable(
  action: ActionDefinition,
  stage: ClientStage,
  capabilities: ClientCapabilities,
): boolean {
  if (action.capability !== undefined && !capabilities[action.capability]) return false;

  if (action.scope === "workspace") return stage === "workspace";

  if (action.scope === "outside-settings") return stage !== "settings";

  return true;
}

type ActionKeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "defaultPrevented"
  | "isComposing"
>;

export function resolveClientAction(
  event: ActionKeyEvent,
  mac: boolean,
  stage: ClientStage,
  capabilities: ClientCapabilities,
): ActionDefinition | undefined {
  if (event.isComposing) return undefined;
  const key = pressedKey(event);
  const entries: readonly ActionDefinition[] = Object.values(clientActions);

  return entries.find((action) => {
    if (action.chord === undefined || !clientActionAvailable(action, stage, capabilities)) {
      return false;
    }
    const terminal = action.chord === "control" || action.chord === "control-shift";

    if (event.defaultPrevented && !terminal) return false;

    if (key !== action.key) return false;

    if (terminal) {
      return (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.shiftKey === (action.chord === "control-shift")
      );
    }

    if (action.chord === "none") return !event.metaKey && !event.ctrlKey && !event.altKey;

    if (!(mac ? event.metaKey : event.ctrlKey)) return false;

    if (action.chord === "primary-alt") return event.altKey;

    return !event.altKey && event.shiftKey === (action.chord === "primary-shift");
  });
}

function pressedKey(event: Pick<KeyboardEvent, "key" | "code">): string {
  if (event.code === "Period") return ".";

  if (event.code === "Backquote") return "`";

  if (event.code === "BracketLeft") return "[";

  if (event.code === "BracketRight") return "]";

  if (event.code === "Space") return "space";

  return /^Digit(\d)$/.exec(event.code)?.[1] ?? event.key.toLowerCase();
}

type TabShortcut =
  | { readonly kind: "activate-index"; readonly index: number }
  | { readonly kind: "cycle-tab"; readonly step: 1 | -1 };

export function resolveTabShortcut(event: ActionKeyEvent, mac: boolean): TabShortcut | undefined {
  if (event.defaultPrevented || event.isComposing) return undefined;
  const primary = mac ? event.metaKey : event.ctrlKey;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

  if (digit !== undefined && primary && !event.altKey && !event.shiftKey) {
    return { kind: "activate-index", index: Number(digit) - 1 };
  }

  if (event.key === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey) {
    return { kind: "cycle-tab", step: event.shiftKey ? -1 : 1 };
  }

  if (
    (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
    primary &&
    event.altKey &&
    !event.shiftKey
  ) {
    return { kind: "cycle-tab", step: event.key === "ArrowRight" ? 1 : -1 };
  }

  return undefined;
}

export function clientActionKeys(action: ActionDefinition, mac: boolean): string[] {
  if (action.chord === undefined) return [];
  const primary = mac ? "⌘" : "Ctrl";
  const shift = mac ? "⇧" : "Shift";
  const key = acceleratorKey(action.key);

  switch (action.chord) {
    case "none":
      return [key];
    case "primary":
      return [primary, key];
    case "primary-shift":
      return [shift, primary, key];
    case "primary-alt":
      return [mac ? "⌥" : "Alt", primary, key];
    case "control":
      return [mac ? "⌃" : "Ctrl", key];
    case "control-shift":
      return [shift, mac ? "⌃" : "Ctrl", key];
  }
}

export function clientActionShortcut(action: ActionDefinition, mac: boolean): string;
export function clientActionShortcut(
  action: ActionDefinition,
  mac: boolean,
  stage: ClientStage,
  capabilities: ClientCapabilities,
): string;
export function clientActionShortcut(
  action: ActionDefinition,
  mac: boolean,
  stage?: ClientStage,
  capabilities?: ClientCapabilities,
): string {
  if (
    stage !== undefined &&
    (capabilities === undefined || !clientActionAvailable(action, stage, capabilities))
  ) {
    return "";
  }

  return clientActionKeys(action, mac).join(mac ? "" : "+");
}

export function clientActionAriaShortcut(action: ActionDefinition, mac: boolean): string {
  return clientActionKeys(action, mac)
    .map((key) => {
      switch (key) {
        case "⌘":
          return "Meta";
        case "⌃":
        case "Ctrl":
          return "Control";
        case "⇧":
          return "Shift";
        case "⌥":
          return "Alt";
        default:
          return key;
      }
    })
    .join("+");
}

function acceleratorKey(key: string): string {
  return key === "space" ? "Space" : key.toUpperCase();
}

export function clientActionAccelerator(action: ActionDefinition): string {
  if (action.chord === undefined) return "";

  if (action.chord === "none") return acceleratorKey(action.key);
  const primary = action.chord.startsWith("primary") ? "CommandOrControl" : "Control";
  const shift = action.chord.endsWith("shift") ? "Shift+" : "";
  const alt = action.chord === "primary-alt" ? "Alt+" : "";

  return `${shift}${alt}${primary}+${acceleratorKey(action.key)}`;
}
