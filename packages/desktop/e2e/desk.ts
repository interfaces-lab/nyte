import { expect, test as base } from "@playwright/test";
import type { ElectronApplication, FrameLocator, Locator, Page } from "@playwright/test";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { launchDesktop } from "./launch.ts";
import { openChat, setTheme, sidebar } from "./ui.ts";
import { captureWindow, screenLocked } from "./window-capture.ts";

/** An app's name on the titlebar's Apps buttons. */
export type DeskApp = "Nyte" | "Code" | "Studio";

export interface Desk {
  readonly application: ElectronApplication;
  /** The project every window opens on: the seeded home, with the sample designs in its `design` folder. */
  readonly home: string;
  /** The window of each app, the latest one opened. */
  page(app: DeskApp): Page;
  /** Opens an app's window on the project from the Apps buttons of `from`, beside it, and waits for its shell. */
  open(app: DeskApp, from: Page): Promise<Page>;
  /** Saves the window as the window server draws it, material and traffic lights included, and attaches it. */
  capture(page: Page, name: string): Promise<string>;
  /**
   * Brings a window to the front, as a person's click on it does. A click the test makes lands in the page without
   * the system making its window the key one, and an editor outside the key window takes no typing. The page is also
   * told it has the focus, so this holds when the system can't give it: a locked screen, or another app in front.
   * With the sidebar hidden, the pointer rests on the page's far side: a real cursor that left the window across its
   * left edge leaves the sidebar floating over it, and a pointer away from that edge sends it back.
   */
  front(page: Page): Promise<void>;
  /** Changes the theme from the Nyte window and waits for every window to show it. */
  setTheme(theme: "light" | "dark"): Promise<void>;
  /**
   * Lays Nyte, Code and Studio side by side across the display, each as wide as a third of it and no narrower than a
   * window can be, with the sidebar hidden. A window the others cover entirely stops drawing, so a change it shows
   * live needs it uncovered. A window that moves out from under the real cursor sees it leave across its left edge and
   * floats its sidebar, so the pointer then rests on each page's far side, as `front` leaves it.
   */
  tile(): Promise<void>;
}

interface DeskFixtures {
  /** The apps opened from Nyte before the test starts, in order. */
  readonly opened: readonly Exclude<DeskApp, "Nyte">[];
  /** Files and folders copied into the project before the launch, by their path in the project, from an absolute path. */
  readonly project: Readonly<Record<string, string>>;
  readonly desk: Desk;
}

const SAMPLE = join(import.meta.dirname, "design-sample");

/** The line of `CONTROLS`, the Controls frame's caption, in the sample's `design/controls.jsx`. */
export const CAPTION = { line: 68 } as const;

/** Just inside the quotes of the Button's default label, `"Continue"`, in the sample's `design/controls.jsx`. */
export const CONTINUE = { line: 36, column: 35, length: 8 } as const;

/** The quiet Button, `<Button label="Not tonight" quiet />`, in the sample's `design/controls.jsx`: its line, and the column after it. */
export const NOT_TONIGHT = { line: 70, end: 43 } as const;

/** The end of `--radius-control: 14px;` in the sample's `design/tokens.css`, a line short enough never to wrap. */
export const RADIUS_END = { line: 18, column: 26 } as const;

const DESK_APPS: readonly DeskApp[] = ["Nyte", "Code", "Studio"];

const NARROWEST = 500;

/**
 * One launch per test for chapters that drive Nyte, Code and Studio together: its own seeded home with the sample
 * designs, the Nyte window open on a chat in that project, and the apps the test names opened beside it. A page error
 * or a `console.error` in any window fails the test, and a failed test keeps a capture of each app's window.
 */
export const test = base.extend<DeskFixtures>({
  opened: [[], { option: true }],
  project: [{}, { option: true }],
  desk: async ({ opened, project }, use, testInfo) => {
    await using stack = new AsyncDisposableStack();
    const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-desk-")));
    stack.defer(() => rm(parent, { recursive: true, force: true }));
    const prepared = await prepareHome(parent);
    await cp(SAMPLE, join(prepared.home, "design"), { recursive: true });

    for (const [path, source] of Object.entries(project))
      await cp(source, join(prepared.home, path), { recursive: true });

    const launched = await launchDesktop({ home: prepared.home, parentDirectory: parent });
    stack.defer(() => launched.close());
    const application = launched.application;
    const problems = [collectErrors(launched.page)];
    const pages = new Map<DeskApp, Page>([["Nyte", launched.page]]);

    if (await screenLocked())
      testInfo.annotations.push({
        type: "captures",
        description:
          "The screen is locked, so captures are of the page alone: no material, traffic lights or shadow.",
      });

    const capture = async (shown: Page, name: string): Promise<string> => {
      const path = testInfo.outputPath(`${name}.png`);
      await (await application.browserWindow(shown)).evaluate((window) => window.moveTop());
      await frames(shown);
      await transitionsDone(shown);
      await testInfo.attach(name, await captureWindow({ application, page: shown }, path));

      return path;
    };

    const open = async (app: DeskApp, from: Page): Promise<Page> => {
      const opening = application.waitForEvent("window");

      await apps(from).getByRole("button", { name: app, exact: true }).click();
      const opened = await opening;

      problems.push(collectErrors(opened));
      await opened.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
      pages.set(app, opened);

      return opened;
    };

    const page = (app: DeskApp): Page => {
      const found = pages.get(app);

      if (found === undefined || found.isClosed()) throw new Error(`No ${app} window is open.`);

      return found;
    };

    const front = async (shown: Page): Promise<void> => {
      const session = await shown.context().newCDPSession(shown);
      await application.evaluate((electron) => electron.app.focus({ steal: true }));
      await (await application.browserWindow(shown)).evaluate((window) => window.focus());
      await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await expect.poll(() => shown.evaluate(() => document.hasFocus())).toBe(true);

      if (!(await shown.getByRole("button", { name: "Show sidebar", exact: true }).isVisible()))
        return;
      const size = await shown.evaluate(() => ({ width: innerWidth, height: innerHeight }));

      await shown.mouse.move(size.width - 8, size.height / 2);
      await expect(sidebar(shown)).toBeHidden();
    };

    const setDeskTheme = async (theme: "light" | "dark"): Promise<void> => {
      await setTheme({ application, page: page("Nyte") }, theme);

      for (const shown of application.windows())
        await expect(shown.locator("html")).toHaveAttribute("data-display-mode", theme);
    };

    const tile = async (): Promise<void> => {
      const shown = DESK_APPS.flatMap((app) => {
        const found = pages.get(app);

        return found === undefined || found.isClosed() ? [] : [found];
      });

      for (const each of shown) {
        const hide = each.getByRole("button", { name: "Hide sidebar", exact: true });

        if (await hide.isVisible()) await hide.click();
        await expect(sidebar(each)).toBeHidden();
      }

      const area = await application.evaluate(
        (electron) => electron.screen.getPrimaryDisplay().workArea,
      );

      const width = Math.max(NARROWEST, Math.floor(area.width / shown.length));
      const step = shown.length > 1 ? (area.width - width) / (shown.length - 1) : 0;

      await Promise.all(
        shown.map(async (each, index) =>
          (await application.browserWindow(each)).evaluate(
            (window, bounds) => window.setBounds(bounds),
            {
              x: Math.round(area.x + index * step),
              y: area.y,
              width,
              height: area.height,
            },
          ),
        ),
      );

      for (const each of shown) {
        await frames(each);
        const size = await each.evaluate(() => ({ width: innerWidth, height: innerHeight }));

        await each.mouse.move(size.width - 8, size.height / 2);
        await expect(sidebar(each)).toBeHidden();
      }
    };

    await openChat(launched.page, FIXTURES.beta);

    for (const app of opened) await open(app, launched.page);

    await use({
      application,
      home: prepared.home,
      page,
      open,
      capture,
      front,
      setTheme: setDeskTheme,
      tile,
    });

    if (testInfo.status !== testInfo.expectedStatus)
      for (const app of DESK_APPS) {
        const shown = pages.get(app);

        if (shown !== undefined && !shown.isClosed())
          await capture(shown, `failed-${app.toLowerCase()}`).catch(() => undefined);
      }

    for (const found of problems) {
      expect(found.pageErrors, "uncaught page errors").toEqual([]);
      expect(
        found.consoleErrors.filter((text) => !text.startsWith("DEV:")),
        "console errors",
      ).toEqual([]);
    }
  },
});

export { expect };

export function apps(page: Page): Locator {
  return page.getByRole("group", { name: "Apps" });
}

export function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

export function editor(page: Page): Locator {
  return workbench(page).getByRole("region", { name: "Editor", exact: true });
}

export function board(page: Page): FrameLocator {
  return workbench(page).locator('iframe[title="Design board"]').contentFrame();
}

/** Waits for the board's camera to land, so what follows acts on, or captures, where it went. */
export async function boardStill(page: Page): Promise<void> {
  await expect(board(page).getByRole("application", { name: "Design board" })).not.toHaveAttribute(
    "data-moving",
  );
}

/** Picks an item of the board's zoom menu, such as Zoom to Fit, and waits for the camera to land. */
export async function zoomBoard(page: Page, item: string): Promise<void> {
  await workbench(page)
    .getByRole("button", { name: /^\d+%$/u })
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  await boardStill(page);
}

/** Closes a window the way its close button does, and waits for it to be gone. */
export async function closeWindow(application: ElectronApplication, page: Page): Promise<void> {
  const closed = page.waitForEvent("close");
  await (await application.browserWindow(page)).evaluate((window) => window.close());
  await closed;
}

/**
 * Opens a file of the project in the window's Editor from its explorer, folder by folder. The Editor's sidebar toggle
 * shows the explorer whether files are open or not, and a Code window that followed the light has some open.
 */
export async function openFile(page: Page, path: string): Promise<Locator> {
  const files = editor(page);
  const explorer = files.getByRole("button", { name: "Editor Sidebar", pressed: false });

  await expect(explorer.or(files.getByRole("treeitem").first())).toBeVisible();

  if (await explorer.isVisible()) await explorer.click();

  const parts = path.split("/");

  for (const folder of parts.slice(0, -1)) {
    const item = files.getByRole("treeitem", { name: startsWith(folder) });

    if ((await item.getAttribute("aria-expanded")) !== "true") await item.click();
  }

  const name = parts.at(-1) ?? path;
  await files.getByRole("treeitem", { name: startsWith(name) }).click();
  const text = files.getByRole("textbox", { name });
  await expect(text).toBeVisible();

  return text;
}

/**
 * Scrolls the open file's `text` with the wheel, down for a positive `delta` and up for a negative one, until `target`
 * is drawn: the editor draws only the lines in view, so a gesture reaches code below the fold once a person scrolls to it.
 */
export async function wheelTo(
  page: Page,
  text: Locator,
  target: Locator,
  delta: number,
): Promise<void> {
  const box = await text.boundingBox();
  const height = await page.evaluate(() => innerHeight);

  if (box === null) throw new Error("The editor drew no text to scroll.");
  const top = Math.max(box.y, 0);

  await page.mouse.move(box.x + box.width / 2, (top + Math.min(box.y + box.height, height)) / 2);

  for (let step = 0; step < 40 && !(await target.isVisible()); step += 1)
    await page.mouse.wheel(0, delta);

  await expect(target).toBeVisible();
}

/** Puts the editor's caret at a line and column of the open file with Go to Line, which the status button opens. */
export async function goTo(page: Page, line: number, column: number): Promise<void> {
  const status = caretStatus(page);

  await status.click();
  await page.keyboard.type(`${String(line)}:${String(column)}`);
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`Ln ${String(line)}, Col ${String(column)}`);
}

/** Selects `length` characters of one line from a line and column, as a person does from the keyboard. */
export async function selectFrom(
  page: Page,
  at: { readonly line: number; readonly column: number; readonly length: number },
): Promise<void> {
  await goTo(page, at.line, at.column);

  for (let step = 0; step < at.length; step += 1) await page.keyboard.press("Shift+ArrowRight");

  await expect(caretStatus(page)).toHaveText(
    `Ln ${String(at.line)}, Col ${String(at.column + at.length)}`,
  );
}

export function caretStatus(page: Page): Locator {
  return editor(page).getByRole("button", { name: /^Ln \d+, Col \d+$/u });
}

async function transitionsDone(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

function startsWith(name: string): RegExp {
  return new RegExp(`^${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
}
