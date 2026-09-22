import { clientActions } from "./client-actions.ts";

export const APP_MENU_COMMAND_CHANNEL = "nyte:app-menu-command";

export const APP_MENU_READY_CHANNEL = "nyte:app-menu-ready";

export type AppMenuAction =
  | typeof clientActions.newChat.id
  | typeof clientActions.openFolder.id
  | typeof clientActions.newTerminal.id
  | typeof clientActions.newBrowser.id
  | typeof clientActions.settings.id;

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electron: string;
  readonly chrome: string;
  readonly os: string;
  readonly arch: string;
}

export type AppMenuCommand =
  | { readonly kind: "action"; readonly action: AppMenuAction }
  | { readonly kind: "about"; readonly info: AppInfo };
