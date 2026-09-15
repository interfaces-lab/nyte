/**
 * Right-click menus are native. Cursor takes the same route on the desktop —
 * its bundles ship no menu widget CSS, only the `vscode:showContextMenu`
 * channel — and a native popup sits above the `WebContentsView`s that browser
 * panels composite over the renderer, which a DOM menu cannot do without
 * registering for overlay occlusion.
 */
import type { ContextMenuTemplateItem, HostState } from "../../../shared/ipc.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";

/** An item owns the work it performs, so no call site matches choices back up. */
export type ContextMenuEntry =
  | Exclude<ContextMenuTemplateItem, { kind: "item" }>
  | (Extract<ContextMenuTemplateItem, { kind: "item" }> & { readonly run: () => void });

/** Matches the system file manager, the way Cursor labels the same action. */
export function revealLabel(platform: HostState["platform"] | undefined): string {
  if (macPlatform(platform)) return "Reveal in Finder";
  return platform === "win32" ? "Reveal in File Explorer" : "Open Containing Folder";
}

/**
 * Runs the chosen entry. Absent entries and the separators they strand are
 * dropped, so a call site turns a whole group off by leaving its items out.
 */
export async function showContextMenu(
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
  const chosen = await nyte.host.contextMenu({
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
