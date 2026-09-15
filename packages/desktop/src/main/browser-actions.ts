import { app, clipboard, dialog, Menu } from "electron";
import type { BrowserWindow, Session, WebContents } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserAction, BrowserMenuAction, HostBridge } from "../shared/ipc.ts";

export async function showBrowserMenu({
  window,
  hasPage,
  input: { bookmarksVisible, x, y },
}: {
  readonly window: BrowserWindow | undefined;
  readonly hasPage: boolean;
  readonly input: Parameters<HostBridge["browser"]["menu"]>[0];
}): Promise<BrowserMenuAction | undefined> {
  if (window === undefined || window.isDestroyed()) return undefined;
  const action = await new Promise<BrowserMenuAction | undefined>((resolve) => {
    const item = (label: string, action: BrowserMenuAction, enabled = true) => ({
      label,
      enabled,
      click: () => resolve(action),
    });
    const menu = Menu.buildFromTemplate([
      item("Take Screenshot", "screenshot", hasPage),
      { type: "separator" },
      item("Hard Reload", "hard-reload", hasPage),
      item("Copy Current URL", "copy-url", hasPage),
      { type: "separator" },
      {
        ...item("Show Bookmark Bar", "toggle-bookmarks"),
        type: "checkbox",
        checked: bookmarksVisible,
      },
      { type: "separator" },
      item("Clear Browsing History", "clear-history"),
      item("Clear Cookies", "clear-cookies"),
      item("Clear Cache", "clear-cache"),
    ]);
    menu.popup({ window, x, y, callback: () => resolve(undefined) });
  });

  if (action === "clear-history" || action === "clear-cookies" || action === "clear-cache") {
    const labels = {
      "clear-history": {
        title: "Clear Browsing History",
        detail: "Remove browsing history from all Nyte browser tabs?",
      },
      "clear-cookies": {
        title: "Clear Cookies",
        detail: "Remove cookies from all Nyte browser tabs? This may sign you out of websites.",
      },
      "clear-cache": { title: "Clear Cache", detail: "Clear the cache used by Nyte browser tabs?" },
    };
    const choice = labels[action];
    const result = await dialog.showMessageBox(window, {
      type: "question",
      message: choice.title,
      detail: choice.detail,
      buttons: ["Cancel", "Clear"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return undefined;
  }
  return action;
}

async function saveBrowserScreenshot({
  contents,
  window,
}: {
  readonly contents: WebContents;
  readonly window: BrowserWindow | undefined;
}): Promise<void> {
  const image = await contents.capturePage();
  if (image.isEmpty()) throw new Error("The page has no image to capture");
  if (window === undefined || window.isDestroyed()) return;
  const result = await dialog.showSaveDialog(window, {
    title: "Save Browser Screenshot",
    defaultPath: join(app.getPath("pictures"), "Nyte Screenshot.png"),
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!result.canceled && result.filePath !== undefined)
    await writeFile(result.filePath, image.toPNG());
}

export async function performBrowserAction({
  action,
  contents,
  guest,
  window,
}: {
  readonly action: Exclude<BrowserAction, "clear-history">;
  readonly contents: WebContents | undefined;
  readonly guest: Session;
  readonly window: BrowserWindow | undefined;
}): Promise<void> {
  if (action === "clear-cookies") {
    await guest.clearStorageData({ storages: ["cookies"] });
    return;
  }
  if (action === "clear-cache") {
    await guest.clearCache();
    return;
  }
  if (contents === undefined || contents.isDestroyed())
    throw new Error("This browser tab is closed");
  switch (action) {
    case "hard-reload":
      contents.reloadIgnoringCache();
      return;
    case "copy-url":
      await clipboard.writeText(contents.getURL());
      return;
    case "screenshot":
      await saveBrowserScreenshot({ contents, window });
      return;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
