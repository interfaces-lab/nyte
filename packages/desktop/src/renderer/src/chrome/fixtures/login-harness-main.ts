/**
 * The window the login harness runs in. Nothing from the real app: no
 * preload, no IPC; the page installs its own recorded bridge.
 */
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const directory = process.env["NYTE_LOGIN_HARNESS_DIR"];
if (directory === undefined) throw new Error("NYTE_LOGIN_HARNESS_DIR is required");
app.setPath("userData", join(directory, "profile"));
app.setPath("sessionData", join(directory, "session"));

void app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  void window.loadFile(join(directory, "login-harness.html"));
});
