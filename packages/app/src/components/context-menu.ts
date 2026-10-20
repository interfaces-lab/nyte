import type { ContextMenuTemplateItem, HostBridge } from "../bridge.ts";

type ContextMenuEntry =
  | Exclude<ContextMenuTemplateItem, { kind: "item" }>
  | (Extract<ContextMenuTemplateItem, { kind: "item" }> & { readonly run: () => void });

export function revealLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "Reveal in Finder";

  return platform === "win32" ? "Reveal in File Explorer" : "Open Containing Folder";
}

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
