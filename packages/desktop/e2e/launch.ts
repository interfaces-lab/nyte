import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { WINDOW_PAINTED_CHANNEL } from "../src/shared/ipc.ts";
import { electronExecutable, startE2eHost } from "./host.ts";
import type { E2eHost } from "./host.ts";
import { describePhases, timed } from "./phases.ts";
import type { Phase, Phases } from "./phases.ts";
import { inspectProcessTree, survivors } from "./process-tree.ts";

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");

const PACKAGES_ROOT = resolve(DESKTOP_ROOT, "..");

/** The e2e build to launch: `out-e2e`, or a copy of one at `NYTE_E2E_OUT`, so a bench can hold a build still while others rebuild. */
export const E2E_OUT = process.env["NYTE_E2E_OUT"] ?? resolve(DESKTOP_ROOT, "out-e2e");

const MAIN_ENTRY = resolve(E2E_OUT, "main/index.js");

const REAP_MS = 5000;

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
  readonly appData?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly places?: string;
  readonly hostDelayMs?: number;
  readonly host?: E2eHost;
  readonly typeAtFirstFrame?: string;
  /** Traces the first window from before it navigates; `globalThis.nyteStopTrace()` in the main process writes the events to `file` as JSON. */
  readonly trace?: { readonly categories: string; readonly file: string };
  /**
   * Keeps the app in the background for benches that run while someone uses the machine: no Dock icon, windows
   * shown without activating, and no window or app focus requests. Pages then need CDP focus emulation to take keys.
   */
  readonly background?: boolean;
}

interface LaunchedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly home: string;
  readonly host: E2eHost;
  readonly output: readonly string[];
  /** Where this launch spent its time until the shell showed: the host's start when it started one, then Electron's. It prints Electron's. */
  readonly phases: Phases;
  close(): Promise<void>;
}

const BUILD_OUTPUTS = [
  [resolve(PACKAGES_ROOT, "canvas/dist/shell/index.html"), "pnpm --dir packages/canvas build"],
  [
    resolve(PACKAGES_ROOT, "app/dist/index.html"),
    "VITE_NYTE_CLERK_PUBLISHABLE_KEY= pnpm --dir packages/app build",
  ],
  [resolve(PACKAGES_ROOT, "tui/dist/nyte-tailnet"), "pnpm --dir packages/tui build"],
  [resolve(DESKTOP_ROOT, "out/renderer/index.html"), "pnpm --dir packages/desktop build"],
  [MAIN_ENTRY, "pnpm --dir packages/desktop build:e2e"],
] as const;

async function assertBuilt(): Promise<void> {
  const missing = await Promise.all(
    BUILD_OUTPUTS.map(([path, command]) =>
      access(path).then(
        () => [],
        () => [`${path}: run ${command}`],
      ),
    ),
  );

  const lines = missing.flat();

  if (lines.length > 0) {
    throw new Error(
      `Missing build outputs. Build them in this order from the repository root:\n${lines.join("\n")}`,
    );
  }
}

function launchEnvironment(options: LaunchOptions, host: E2eHost) {
  const kept = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && KEPT_VARIABLES.has(entry[0]),
  );

  return {
    ...Object.fromEntries(kept),
    ...host.environment,
    HOME: options.home,
    USERPROFILE: options.home,
  };
}

/** Launches without colour-scheme emulation: the window's vibrancy follows the native theme, so the page must too. */
export async function launchDesktop(options: LaunchOptions): Promise<LaunchedDesktop> {
  await assertBuilt();
  const root = await mkdtemp(join(options.parentDirectory, "desktop-"));
  const appData = options.appData ?? join(root, "app-data");
  await mkdir(appData, { recursive: true });
  await symlink(
    join(PACKAGES_ROOT, "canvas"),
    join(options.parentDirectory, "canvas"),
    "junction",
  ).catch((cause: unknown) => {
    if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
  });

  const downloads =
    options.downloadsDirectory === undefined
      ? ""
      : `app.setPath("downloads", ${JSON.stringify(resolve(options.downloadsDirectory))});\n`;

  const typing =
    options.typeAtFirstFrame === undefined
      ? ""
      : `ipcMain.once(${JSON.stringify(WINDOW_PAINTED_CHANNEL)}, (event) => {\n  for (const character of ${JSON.stringify(Array.from(new Intl.Segmenter().segment(options.typeAtFirstFrame), ({ segment }) => segment))}) {\n    const key = character === " " ? "Space" : character;\n    event.sender.sendInputEvent({ type: "keyDown", keyCode: key });\n    event.sender.sendInputEvent({ type: "char", keyCode: character });\n    event.sender.sendInputEvent({ type: "keyUp", keyCode: key });\n  }\n});\n`;

  const tracing =
    options.trace === undefined
      ? ""
      : `const traced = [];\nlet traceSession;\napp.on("web-contents-created", (_, contents) => {\n  if (traceSession !== undefined || contents.getType() !== "window") return;\n  traceSession = contents.debugger;\n  traceSession.attach("1.3");\n  traceSession.on("message", (_, method, params) => {\n    if (method === "Tracing.dataCollected") traced.push(...params.value);\n  });\n  void traceSession.sendCommand("Tracing.start", { categories: ${JSON.stringify(options.trace.categories)}, transferMode: "ReportEvents" });\n});\nglobalThis.nyteStopTrace = () => new Promise((resolve) => {\n  traceSession.on("message", (_, method) => {\n    if (method === "Tracing.tracingComplete") writeFile(${JSON.stringify(options.trace.file)}, JSON.stringify(traced)).then(resolve);\n  });\n  void traceSession.sendCommand("Tracing.end");\n});\n`;

  const background =
    options.background === true
      ? `if (process.platform === "darwin") app.whenReady().then(() => app.setActivationPolicy("accessory"));\nBrowserWindow.prototype.show = function () { this.showInactive(); };\nBrowserWindow.prototype.focus = function () {};\nBrowserWindow.prototype.moveTop = function () {};\napp.focus = () => {};\n`
      : "";

  await writeFile(
    join(root, "environment.mjs"),
    `import { app, BrowserWindow, ipcMain } from "electron";\nimport { writeFile } from "node:fs/promises";\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setPath("userData", ${JSON.stringify(join(appData, "user-data"))});\n${downloads}${typing}${tracing}${background}`,
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

  const output: string[] = [];

  const host =
    options.host ??
    (await startE2eHost({
      home: options.home,
      parentDirectory: options.parentDirectory,
      places: options.places,
      environment: options.environment,
      output,
    }));

  const phases: Phase[] = [];

  const stopHost = (): Promise<void> =>
    options.host === undefined ? host.close() : Promise.resolve();

  if (options.hostDelayMs !== undefined) await host.hold(options.hostDelayMs);

  const application = await timed(phases, "electron launch", async () =>
    _electron.launch({
      executablePath: await electronExecutable(),
      args: [
        root,
        "--use-mock-keychain",
        "--password-store=basic",
        ...(process.env.NYTE_E2E_60FPS === "1"
          ? ["--enable-features=ThrottleMainFrameTo60Hz"]
          : []),
        ...(process.env.NYTE_E2E_SWITCHES?.split(" ").filter((entry) => entry !== "") ?? []),
      ],
      cwd: DESKTOP_ROOT,
      env: launchEnvironment(options, host),
      colorScheme: null,
      timeout: 30_000,
    }),
  ).catch(async (cause: unknown) => {
    await stopHost();
    throw cause;
  });

  const child = application.process();

  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => output.push(chunk));
  }

  const quit = async (): Promise<void> => {
    await application.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };

  const close = async (): Promise<void> => {
    const tree = await inspectProcessTree(child.pid);
    await quit();
    const left = tree === null ? [] : await survivors(tree, REAP_MS);
    await stopHost();

    if (left.length > 0) {
      throw new Error(
        `The desktop's processes outlived close(): ${left.map((row) => `${String(row.pid)} ${row.command}`).join(", ")}`,
      );
    }
  };

  try {
    const page = await timed(phases, "first window", () => application.firstWindow());
    await timed(phases, "shell visible", () =>
      page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 }),
    );
    process.stdout.write(`desktop launch: ${describePhases(phases)}\n`);

    return {
      application,
      page,
      home: options.home,
      host,
      output,
      phases: options.host === undefined ? [...host.phases, ...phases] : phases,
      close,
    };
  } catch (cause) {
    await quit();
    await stopHost();
    throw cause;
  }
}
