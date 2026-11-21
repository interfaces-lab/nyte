import { execFile } from "node:child_process";
import { extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { app, shell } from "electron";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

const run = promisify(execFile);

/**
 * Opens an HTML file in the default web browser. On macOS the default app for `.html` can be an editor, Nyte
 * included, so the file goes to the app that opens web links instead.
 */
export async function openInBrowser(path: string): Promise<void> {
  if (!isAbsolute(path) || !HTML_EXTENSIONS.has(extname(path).toLowerCase()))
    throw new Error("Only an HTML file opens in the browser.");

  if (process.platform !== "darwin") return shell.openExternal(pathToFileURL(path).href);
  const browser = await app.getApplicationInfoForProtocol("https://");
  await run("open", ["-a", browser.path, path]);
}
