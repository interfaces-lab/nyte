type ActionChord =
  | "primary"
  | "primary-shift"
  | "primary-alt"
  | "control"
  | "control-shift"
  | "none";
type ClientStage = "workspace" | "customize" | "settings";

interface ActionDetails {
  readonly id: string;
  readonly label: string;
  readonly scope: "window" | "workspace" | "outside-settings";
  readonly palette?: {
    readonly keywords: string;
    readonly icon: string;
    readonly group: "actions" | "settings";
  };
}

type ActionDefinition = ActionDetails &
  (
    | { readonly key: string; readonly chord: ActionChord }
    | { readonly key?: never; readonly chord?: never }
  );

/** Window actions only. Editors, terminals, and browser pages own their input bindings. */
export const clientActions = {
  newChat: {
    id: "new-chat",
    label: "New chat",
    key: "n",
    chord: "primary",
    scope: "window",
    palette: { keywords: "start create conversation session", icon: "plus", group: "actions" },
  },
  openFolder: {
    id: "open-folder",
    label: "Open folder…",
    scope: "window",
    palette: {
      keywords: "workspace project directory choose",
      icon: "folder-open",
      group: "actions",
    },
  },
  openHome: {
    id: "open-home",
    label: "Open home",
    scope: "window",
    palette: { keywords: "workspace projectless activate", icon: "folder", group: "actions" },
  },
  generalSettings: {
    id: "general-settings",
    label: "General settings",
    scope: "window",
    palette: { keywords: "preferences configuration", icon: "settings", group: "settings" },
  },
  appearanceSettings: {
    id: "appearance-settings",
    label: "Appearance",
    scope: "window",
    palette: { keywords: "theme color interface", icon: "sparkle", group: "settings" },
  },
  modelSettings: {
    id: "model-settings",
    label: "Models",
    scope: "window",
    palette: {
      keywords: "providers api key sign in anthropic openai default reasoning",
      icon: "layers",
      group: "settings",
    },
  },
  accountSettings: {
    id: "account-settings",
    label: "Accounts",
    scope: "window",
    palette: { keywords: "github login authentication", icon: "user", group: "settings" },
  },
  customize: {
    id: "customize-settings",
    label: "Customize",
    scope: "window",
    palette: { keywords: "agents skills rules mcp", icon: "customize", group: "settings" },
  },
  search: { id: "search", label: "Search", key: "k", chord: "primary", scope: "window" },
  settings: {
    id: "settings",
    label: "Settings",
    key: ",",
    chord: "primary",
    scope: "outside-settings",
  },
  back: { id: "back", label: "Go back", key: "[", chord: "primary", scope: "window" },
  forward: { id: "forward", label: "Go forward", key: "]", chord: "primary", scope: "window" },
  sidebar: {
    id: "sidebar",
    label: "Toggle sidebar",
    key: "b",
    chord: "primary",
    scope: "outside-settings",
  },
  splitRight: {
    id: "split-right",
    label: "Split right",
    key: "d",
    chord: "primary",
    scope: "workspace",
  },
  splitDown: {
    id: "split-down",
    label: "Split down",
    key: "d",
    chord: "primary-shift",
    scope: "workspace",
  },
  workbench: {
    id: "workbench",
    label: "Toggle workbench",
    key: "b",
    chord: "primary-alt",
    scope: "workspace",
  },
  terminal: {
    id: "terminal",
    label: "Toggle terminal",
    key: "`",
    chord: "control",
    scope: "workspace",
  },
  newTerminal: {
    id: "new-terminal",
    label: "New terminal",
    key: "`",
    chord: "control-shift",
    scope: "workspace",
  },
  focusPane: {
    id: "focus-pane",
    label: "Focus next pane",
    key: "f6",
    chord: "none",
    scope: "workspace",
  },
} as const satisfies Record<string, ActionDefinition>;

type ClientAction = (typeof clientActions)[keyof typeof clientActions];

export function clientActionAvailable(action: ActionDefinition, stage: ClientStage): boolean {
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
): ClientAction | undefined {
  if (event.isComposing) return undefined;
  return Object.values(clientActions).find((action) => {
    if (!("chord" in action) || !clientActionAvailable(action, stage)) return false;
    const terminal = action.chord === "control" || action.chord === "control-shift";
    // Ghostty prevents the default for the Backquote chord it hands back to the shell.
    // Other consumed events must remain with the editor or terminal that handled them.
    if (event.defaultPrevented && !terminal) return false;
    if (terminal ? event.code !== "Backquote" : event.key.toLowerCase() !== action.key)
      return false;
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
    // The workbench chord has always accepted Shift as well.
    if (action.chord === "primary-alt") return event.altKey;
    return !event.altKey && event.shiftKey === (action.chord === "primary-shift");
  });
}

export function clientActionKeys(action: ActionDefinition, mac: boolean): string[] {
  if (action.chord === undefined) return [];
  const primary = mac ? "⌘" : "Ctrl";
  const shift = mac ? "⇧" : "Shift";
  const key = action.key.toUpperCase();
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

export function clientActionShortcut(
  action: ActionDefinition,
  mac: boolean,
  stage?: ClientStage,
): string {
  if (stage !== undefined && !clientActionAvailable(action, stage)) return "";
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

export function clientActionAccelerator(action: ActionDefinition): string {
  if (action.chord === undefined) return "";
  if (action.chord === "none") return action.key.toUpperCase();
  const primary = action.chord.startsWith("primary") ? "CommandOrControl" : "Control";
  const shift = action.chord.endsWith("shift") ? "Shift+" : "";
  const alt = action.chord === "primary-alt" ? "Alt+" : "";
  return `${shift}${alt}${primary}+${action.key.toUpperCase()}`;
}
