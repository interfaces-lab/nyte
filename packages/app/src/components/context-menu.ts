/**
 * Native right-click menus sit above the browser panels' `WebContentsView`s.
 * A DOM menu would hide any page it covered.
 */
import type { ContextMenuTemplateItem, HostBridge, HostState } from "../bridge.ts";
import { macPlatform } from "../platform.ts";

/** An item owns the work it performs, so no call site matches choices back up. */
export type ContextMenuEntry =
  | Exclude<ContextMenuTemplateItem, { kind: "item" }>
  | (Extract<ContextMenuTemplateItem, { kind: "item" }> & { readonly run: () => void });

/** Matches the system file manager. */
export function revealLabel(platform: HostState["platform"] | undefined): string {
  if (macPlatform(platform)) return "Reveal in Finder";

  return platform === "win32" ? "Reveal in File Explorer" : "Open Containing Folder";
}

/**
 * Runs the chosen entry. Absent entries and the separators they strand are
 * dropped, so a call site turns a whole group off by leaving its items out.
 * The caller holds the host's menu, so a host without one attaches nothing.
 */
export async function showContextMenu(
  contextMenu: NonNullable<HostBridge["contextMenu"]>,
  event: { readonly clientX: number; readonly clientY: number },
  entries: readonly (ContextMenuEntry | false | undefined)[],
): Promise<void> {
  const present = entries.filter((entry) => entry !== false && entry !== undefined);

  const menu = present.filter(
    (entry, index) =>
      entry.kind !== "separator" ||
      (index > 0 && index < present.length - 1 && present[index - 1]?.kind !== "separator"),
  );

  if (menu.length === 0) return;

  const chosen = await contextMenu({
    items: menu.map<ContextMenuTemplateItem>((entry) =>
      entry.kind === "item"
        ? {
            kind: "item",
            label: entry.label,
            accelerator: entry.accelerator,
            enabled: entry.enabled,
          }
        : entry,
    ),
    x: Math.round(event.clientX),
    y: Math.round(event.clientY),
  });

  if (chosen === undefined) return;
  const entry = menu[chosen];

  if (entry?.kind === "item") entry.run();
}
