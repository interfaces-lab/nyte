import type { IconName } from "@nyte-ai/ui/icon";
import {
  clientActionAvailable,
  clientActionKeys,
  clientActions,
} from "../contract/client-actions.ts";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import { appActions } from "../data/app-actions.ts";
import { actionIcons } from "../settings-sections/action-icons.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import type { PaletteCommand } from "./file-palette.tsx";

const ICONS: ReadonlyMap<string, IconName> = new Map(Object.entries(actionIcons));

/**
 * Every named action this window can run, as rows of the Commands tab. Switching apps stays with the title bar's
 * switch, and the window tab actions leave with the window tabs.
 */
export function appCommands(mac: boolean, capabilities: ClientCapabilities): PaletteCommand[] {
  return Object.values(clientActions).flatMap((entry): PaletteCommand[] => {
    if (!("action" in entry) || !clientActionAvailable(entry, "workspace", capabilities)) return [];

    if (entry.action === "app.open") return [];

    if ((entry.action === "tab.new" || entry.action === "tab.reopen") && !windowTabs.strip) {
      return [];
    }

    const action = entry.action;
    const input = "input" in entry ? entry.input : {};

    return [
      {
        key: entry.id,
        label: entry.label,
        icon: ICONS.get(entry.id) ?? "command",
        keys: clientActionKeys(entry, mac),
        group: "Window",
        run: () => void appActions.run(action, input),
      },
    ];
  });
}
