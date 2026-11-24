import { dialog } from "electron";
import type { BrowserWindow } from "electron";
import { installCli } from "./native/cli.ts";

export async function confirmExternal(
  url: string,
  window: BrowserWindow | undefined,
): Promise<"open" | "copy" | "trust" | "cancel"> {
  const options: Electron.MessageBoxOptions = {
    type: "question",
    message: "Do you want Nyte to open the external website?",
    detail: url,
    buttons: ["Open", "Copy", `Always Open ${new URL(url).host}`, "Cancel"],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  };

  const { response } =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);

  return (["open", "copy", "trust", "cancel"] as const)[response] ?? "cancel";
}

export async function pickFolder(window: BrowserWindow | undefined): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    message: "Open a workspace folder",
  };

  const result =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);

  return result.canceled ? undefined : result.filePaths[0];
}

export async function installStagedCli(home: string, staged: Promise<string>): Promise<void> {
  try {
    const detail = await installCli(home, await staged, process.env["SHELL"]);
    await dialog.showMessageBox({ type: "info", message: "Installed the nyte command.", detail });
  } catch (cause) {
    dialog.showErrorBox(
      "Couldn't install the nyte command",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
