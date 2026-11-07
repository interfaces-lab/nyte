import type { IconName } from "@nyte-ai/ui/icon";
import { clientActions } from "../contract/client-actions.ts";
import { SETTINGS_PAGES, type SettingsSection } from "../settings/pages.ts";

type ClientAction = (typeof clientActions)[keyof typeof clientActions];

type IconActionId =
  | Extract<ClientAction, { readonly palette: unknown }>["id"]
  | typeof clientActions.search.id
  | typeof clientActions.settings.id;

export const settingsActionPages = {
  "general-settings": "general",
  "appearance-settings": "appearance",
  "model-settings": "providers",
  "profile-settings": "profile",
  settings: "general",
} as const satisfies Partial<Record<ClientAction["id"], SettingsSection>>;

export const actionIcons = {
  "new-chat": "new-chat",
  "open-folder": "folder-open",
  "open-home": "folder",
  "general-settings": SETTINGS_PAGES[settingsActionPages["general-settings"]].icon,
  "appearance-settings": SETTINGS_PAGES[settingsActionPages["appearance-settings"]].icon,
  "model-settings": SETTINGS_PAGES[settingsActionPages["model-settings"]].icon,
  "profile-settings": SETTINGS_PAGES[settingsActionPages["profile-settings"]].icon,
  "customize-settings": "customize",
  "reload-window": "refresh",
  search: "search",
  settings: SETTINGS_PAGES[settingsActionPages.settings].icon,
} as const satisfies Record<IconActionId, IconName>;
