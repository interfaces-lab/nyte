export const APP_MENU_COMMAND_CHANNEL = "nyte:app-menu-command";
export const APP_MENU_READY_CHANNEL = "nyte:app-menu-ready";

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electron: string;
  readonly chrome: string;
  readonly os: string;
  readonly arch: string;
}

export type AppMenuCommand =
  | { readonly kind: "settings" }
  | { readonly kind: "about"; readonly info: AppInfo };
