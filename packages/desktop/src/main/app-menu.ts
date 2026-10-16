import { nativeImage } from "electron";
import type { App, BaseWindow, MenuItemConstructorOptions, WebContents } from "electron";
import type {
  AppInfo,
  AppMenuAction,
  AppMenuCommand,
  BrowserKey,
  BrowserNavigationAction,
} from "@nyte-ai/app/bridge.ts";
import { clientActionAccelerator, clientActions } from "@nyte-ai/app/client-actions.ts";
import { shortcutCharacter } from "@nyte-ai/app/workbench/browser-shortcuts.ts";

export type ViewCommand = Extract<
  BrowserNavigationAction,
  "reload" | "hard-reload" | "toggle-devtools" | "zoom-reset" | "zoom-in" | "zoom-out"
>;

export function applicationMenuTemplate(options: {
  platform: NodeJS.Platform;
  name: string;
  appInfo: () => AppInfo;
  dispatch: (command: AppMenuCommand) => void;
  newWindow: () => void;
  view: (command: ViewCommand, window: BaseWindow | undefined) => void;
  /** Development builds add Reload, Force Reload and the window's developer tools to View. */
  developer: boolean;
}): MenuItemConstructorOptions[] {
  const about = {
    label: `About ${options.name}`,
    click: () => options.dispatch({ kind: "about", info: options.appInfo() }),
  };

  const action = (
    definition: Extract<(typeof clientActions)[keyof typeof clientActions], { id: AppMenuAction }>,
  ): MenuItemConstructorOptions => {
    const accelerator = clientActionAccelerator(definition);

    return {
      label: definition.label,
      accelerator: accelerator === "" ? undefined : accelerator,
      click: () => options.dispatch({ kind: "action", action: definition.id }),
    };
  };

  const settings = action(clientActions.settings);

  const fileActions = [
    { label: "New Window", accelerator: "Shift+CommandOrControl+N", click: options.newWindow },
    action(clientActions.newChat),
    action(clientActions.newTab),
    action(clientActions.openFolder),
    { type: "separator" },
    action(clientActions.newTerminal),
    action(clientActions.newBrowser),
  ] satisfies MenuItemConstructorOptions[];

  const update = { id: "check-for-updates", label: "Check for Updates…" };

  const view = (
    label: string,
    accelerator: string,
    command: ViewCommand,
  ): MenuItemConstructorOptions => ({
    id: command,
    label,
    accelerator,
    click: (_item, window) => options.view(command, window),
  });

  return [
    ...(options.platform === "darwin"
      ? [
          {
            label: options.name,
            submenu: [
              about,
              { ...update, icon: nativeImage.createMenuSymbol("arrow.down.circle") },
              { type: "separator" },
              { ...settings, icon: nativeImage.createMenuSymbol("gearshape") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", icon: nativeImage.createMenuSymbol("xmark.square") },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu:
        options.platform === "darwin"
          ? [
              ...fileActions,
              { type: "separator" },
              action(clientActions.reopenTab),
              action(clientActions.closeTab),
              { role: "close", accelerator: "Shift+CommandOrControl+W" },
            ]
          : [
              ...fileActions,
              { type: "separator" },
              action(clientActions.reopenTab),
              action(clientActions.closeTab),
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "quit" },
            ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(options.developer
          ? [
              view("Reload", "CommandOrControl+R", "reload"),
              view("Force Reload", "Shift+CommandOrControl+R", "hard-reload"),
              view(
                "Toggle Developer Tools",
                options.platform === "darwin" ? "Alt+Command+I" : "Control+Shift+I",
                "toggle-devtools",
              ),
              { type: "separator" } satisfies MenuItemConstructorOptions,
            ]
          : []),
        view("Actual Size", "CommandOrControl+0", "zoom-reset"),
        view("Zoom In", "CommandOrControl+Plus", "zoom-in"),
        view("Zoom Out", "CommandOrControl+-", "zoom-out"),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // ⌘W closes a tab, so closing the window takes Shift.
    options.platform === "darwin"
      ? { role: "windowMenu" }
      : {
          role: "windowMenu",
          submenu: [
            { role: "minimize" },
            { role: "close", accelerator: "Shift+CommandOrControl+W" },
          ],
        },
    { role: "help", submenu: options.platform === "darwin" ? [] : [about, update] },
  ];
}

/** Menu actions can reopen a closed window before its renderer has subscribed. */
export function createMenuCommandDelivery(options: {
  openWindow: () => void;
  send: (command: AppMenuCommand) => void;
}) {
  let ready = false;
  const pending: AppMenuCommand[] = [];

  return {
    dispatch: (command: AppMenuCommand): void => {
      options.openWindow();

      if (ready) options.send(command);
      else pending.push(command);
    },
    ready(): void {
      ready = true;

      for (const command of pending.splice(0)) options.send(command);
    },
    reset(): void {
      ready = false;
    },
  };
}

const ACCELERATOR_KEYS = new Map([
  ["plus", "+"],
  ["space", " "],
  ["esc", "escape"],
  ["return", "enter"],
  ["up", "arrowup"],
  ["down", "arrowdown"],
  ["left", "arrowleft"],
  ["right", "arrowright"],
]);

const CODE_KEYS = new Map([
  ["Minus", "-"],
  ["Equal", "="],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Backquote", "`"],
  ["Comma", ","],
  ["Period", "."],
  ["Slash", "/"],
  ["Backslash", "\\"],
  ["Semicolon", ";"],
  ["Quote", "'"],
]);

export function acceleratorMatches(accelerator: string, key: BrowserKey, mac: boolean): boolean {
  const parts = accelerator.toLowerCase().split("+");
  const name = parts.pop() ?? "";
  const has = (...names: string[]): boolean => parts.some((part) => names.includes(part));
  const primary = has("commandorcontrol", "cmdorctrl");

  if (
    key.metaKey !== (has("command", "cmd", "super", "meta") || (mac && primary)) ||
    key.ctrlKey !== (has("control", "ctrl") || (!mac && primary)) ||
    key.altKey !== has("alt", "option") ||
    key.shiftKey !== has("shift")
  )
    return false;
  const wanted = ACCELERATOR_KEYS.get(name) ?? name;
  const character = shortcutCharacter(key);

  if (character !== undefined) return character === wanted;

  return key.key.toLowerCase() === wanted || CODE_KEYS.get(key.code) === wanted;
}

interface KeyMenu<Item> {
  readonly items: readonly Item[];
}

interface KeyMenuItem<Item> {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly accelerator: string | null | undefined;
  readonly submenu?: KeyMenu<Item> | null;
}

export function menuItemForKey<Item extends KeyMenuItem<Item>>(
  menu: KeyMenu<Item>,
  key: BrowserKey,
  mac: boolean,
): Item | undefined {
  for (const item of menu.items) {
    if (!item.enabled || !item.visible) continue;
    const nested = item.submenu ? menuItemForKey(item.submenu, key, mac) : undefined;

    if (nested !== undefined) return nested;
    const accelerator = item.accelerator ?? "";

    if (accelerator !== "" && acceleratorMatches(accelerator, key, mac)) return item;
  }

  return undefined;
}

export function menuItemRepeats(item: { readonly id: string }): boolean {
  return item.id === "zoom-in" || item.id === "zoom-out";
}

export interface MenuRoleTarget {
  readonly app: Pick<App, "quit" | "hide">;
  readonly window: Pick<BaseWindow, "minimize" | "close" | "isFullScreen" | "setFullScreen">;
  readonly contents: Pick<
    WebContents,
    "undo" | "redo" | "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "selectAll"
  >;
  readonly sendAction: (action: string) => void;
}

export function performMenuRole(role: string, target: MenuRoleTarget): boolean {
  switch (role.toLowerCase()) {
    case "quit":
      target.app.quit();

      return true;
    case "hide":
      target.app.hide();

      return true;
    case "hideothers":
      target.sendAction("hideOtherApplications:");

      return true;
    case "minimize":
      target.window.minimize();

      return true;
    case "close":
      target.window.close();

      return true;
    case "togglefullscreen":
      target.window.setFullScreen(!target.window.isFullScreen());

      return true;
    case "undo":
      target.contents.undo();

      return true;
    case "redo":
      target.contents.redo();

      return true;
    case "cut":
      target.contents.cut();

      return true;
    case "copy":
      target.contents.copy();

      return true;
    case "paste":
      target.contents.paste();

      return true;
    case "pasteandmatchstyle":
      target.contents.pasteAndMatchStyle();

      return true;
    case "selectall":
      target.contents.selectAll();

      return true;
    default:
      return false;
  }
}
