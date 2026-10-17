import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { WINDOW_PAINTED_CHANNEL } from "../src/shared/ipc.ts";

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");

const PACKAGES_ROOT = resolve(DESKTOP_ROOT, "..");

const MAIN_ENTRY = resolve(DESKTOP_ROOT, "out-e2e/main/index.js");

const KEPT_VARIABLES = new Set([
  "PATH",
  "SHELL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TERM",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
]);

interface LaunchOptions {
  readonly home: string;
  readonly parentDirectory: string;
  readonly downloadsDirectory?: string;
  /** Electron's app data, kept across launches when given; a fresh one under the launch otherwise. */
  readonly appData?: string;
  /** Hold the host this long before it opens. */
  readonly hostDelayMs?: number;
  /**
   * Typed into the focused element by main the moment the renderer reports its first frame,
   * long before Playwright could reach the window.
   */
  readonly typeAtFirstFrame?: string;
}

interface LaunchedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly home: string;
  readonly output: readonly string[];
  close(): Promise<void>;
}

async function assertBuilt(): Promise<void> {
  const required = [
    [MAIN_ENTRY, "pnpm --dir packages/desktop build:e2e"],
    [resolve(DESKTOP_ROOT, "out/renderer/index.html"), "pnpm --dir packages/desktop build"],
    [resolve(PACKAGES_ROOT, "app/dist/index.html"), "pnpm --dir packages/app build"],
  ] as const;

  for (const [path, command] of required) {
    await access(path).catch(() => {
      throw new Error(`Missing ${path}. Run ${command} first.`);
    });
  }
}

async function electronExecutable(): Promise<string> {
  const electronRoot = join(DESKTOP_ROOT, "node_modules/electron");
  const executable = await readFile(join(electronRoot, "path.txt"), "utf8");

  return join(electronRoot, "dist", executable.trim());
}

function launchEnvironment(home: string, hostDelayMs: number | undefined) {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && KEPT_VARIABLES.has(entry[0]),
  );

  return {
    ...Object.fromEntries(kept),
    HOME: home,
    USERPROFILE: home,
    NYTE_DESKTOP_HOST_DELAY_MS: hostDelayMs === undefined ? "" : String(hostDelayMs),
  };
}

export async function launchDesktop(options: LaunchOptions): Promise<LaunchedDesktop> {
  await assertBuilt();
  const root = await mkdtemp(join(options.parentDirectory, "desktop-"));
  const appData = options.appData ?? join(root, "app-data");
  await mkdir(appData, { recursive: true });
  await symlink(
    join(PACKAGES_ROOT, "canvas"),
    join(options.parentDirectory, "canvas"),
    "junction",
  ).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "EEXIST") throw cause;
  });

  const downloads =
    options.downloadsDirectory === undefined
      ? ""
      : `app.setPath("downloads", ${JSON.stringify(resolve(options.downloadsDirectory))});\n`;

  const typing =
    options.typeAtFirstFrame === undefined
      ? ""
      : `ipcMain.once(${JSON.stringify(WINDOW_PAINTED_CHANNEL)}, (event) => {\n  for (const character of ${JSON.stringify(Array.from(new Intl.Segmenter().segment(options.typeAtFirstFrame), ({ segment }) => segment))}) {\n    const key = character === " " ? "Space" : character;\n    event.sender.sendInputEvent({ type: "keyDown", keyCode: key });\n    event.sender.sendInputEvent({ type: "char", keyCode: character });\n    event.sender.sendInputEvent({ type: "keyUp", keyCode: key });\n  }\n});\n`;

  await writeFile(
    join(root, "environment.mjs"),
    `import { app, ipcMain } from "electron";\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setPath("userData", ${JSON.stringify(join(appData, "user-data"))});\n${downloads}${typing}`,
  );
  await writeFile(
    join(root, "entry.mjs"),
    `import "./environment.mjs";\nimport ${JSON.stringify(pathToFileURL(MAIN_ENTRY).href)};\n`,
  );

  const metadata = Value.Parse(
    Type.Object({ name: Type.String(), version: Type.String() }),
    JSON.parse(await readFile(join(DESKTOP_ROOT, "package.json"), "utf8")),
  );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: metadata.name, version: metadata.version, main: "entry.mjs" }),
  );
  await symlink(join(DESKTOP_ROOT, "resources"), join(root, "resources"), "junction");

  const application = await _electron.launch({
    executablePath: await electronExecutable(),
    args: [root, "--use-mock-keychain", "--password-store=basic"],
    cwd: DESKTOP_ROOT,
    env: launchEnvironment(options.home, options.hostDelayMs),
    timeout: 30_000,
  });

  const output: string[] = [];
  const child = application.process();

  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => output.push(chunk));
  }

  const close = async (): Promise<void> => {
    await application.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };

  try {
    const page = await application.firstWindow();
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });

    return { application, page, home: options.home, output, close };
  } catch (cause) {
    await close();
    throw cause;
  }
}
