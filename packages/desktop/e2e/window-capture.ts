import type { ElectronApplication, Page } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";

export interface ShownWindow {
  readonly application: ElectronApplication;
  readonly page: Page;
}

export interface Capture {
  readonly path: string;
  readonly contentType: string;
}

export interface Recording {
  stop(): Promise<Capture>;
}

const run = promisify(execFile);

const ListedType = Type.Array(
  Type.Object({
    id: Type.Number(),
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  }),
);

const LIST_WINDOWS = `
ObjC.import("CoreGraphics");
const shown = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(shown, 0)));
JSON.stringify(all.map((w) => ({
  id: w.kCGWindowNumber, x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y,
  width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height,
})));
`;

const SHOWN_MS = 5_000;

/**
 * Whether the Mac's screen is locked. The window server draws no window then, so a capture can only be of the page,
 * and that is the machine's state, not a fault in the app.
 */
export async function screenLocked(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const session = (await run("ioreg", ["-n", "Root", "-d1", "-a"])).stdout;

  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/u.test(session);
}

/**
 * On macOS the window server draws the vibrancy behind the page, so a page screenshot or screencast
 * leaves the glass transparent or black. These ask the window server for the composited window, and
 * fall back to the page while the screen is locked.
 */
export async function captureWindow(window: ShownWindow, path: string): Promise<Capture> {
  if (process.platform !== "darwin" || (await screenLocked())) {
    await window.page.screenshot({ path });

    return { path, contentType: "image/png" };
  }

  await run("screencapture", ["-x", "-o", `-l${await windowNumber(window)}`, path]);
  await written(path);

  return { path, contentType: "image/png" };
}

/** `name` is the output path without an extension; the platform picks the container. */
export async function recordWindow(window: ShownWindow, name: string): Promise<Recording> {
  if (process.platform !== "darwin" || (await screenLocked())) {
    const path = `${name}.webm`;
    await window.page.screencast.start({ path });

    return {
      stop: async () => {
        await window.page.screencast.stop();

        return { path, contentType: "video/webm" };
      },
    };
  }

  const path = `${name}.mov`;
  const recorder = spawn("screencapture", ["-x", "-v", `-l${await windowNumber(window)}`, path]);
  const exited = once(recorder, "exit");

  return {
    stop: async () => {
      recorder.kill("SIGINT");
      await exited;
      await written(path);

      return { path, contentType: "video/quicktime" };
    },
  };
}

async function windowNumber(window: ShownWindow): Promise<string> {
  const browserWindow = await window.application.browserWindow(window.page);

  const shown = await browserWindow.evaluate((own) => ({
    source: own.getMediaSourceId(),
    frame: own.getBounds(),
  }));

  const number = /^window:(\d+):/u.exec(shown.source)?.[1];

  if (number === undefined) throw new Error(`Expected a window media source, got ${shown.source}`);
  const deadline = performance.now() + SHOWN_MS;

  while (!(await onScreen(Number(number), shown.frame))) {
    if (performance.now() > deadline)
      throw new Error(
        `The window server shows no window ${number} at ${JSON.stringify(shown.frame)}.`,
      );
    await new Promise((done) => setTimeout(done, 100));
  }

  return number;
}

async function onScreen(
  id: number,
  frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): Promise<boolean> {
  const listed = Value.Parse(
    ListedType,
    JSON.parse((await run("osascript", ["-l", "JavaScript", "-e", LIST_WINDOWS])).stdout),
  );

  return listed.some(
    (window) =>
      window.id === id &&
      window.x === frame.x &&
      window.y === frame.y &&
      window.width === frame.width &&
      window.height === frame.height,
  );
}

async function written(path: string): Promise<void> {
  await access(path).catch(() => {
    throw new Error(
      `screencapture wrote no ${path}. Grant Screen Recording to the app that runs the tests.`,
    );
  });
}
