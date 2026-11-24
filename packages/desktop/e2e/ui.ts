import { expect } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

export const mac = process.platform === "darwin";

export const primaryKey = mac ? "⌘" : "Ctrl";

export const shiftKey = mac ? "⇧" : "Shift";

export function menuShortcut(...keys: readonly string[]): string {
  return keys.join(mac ? "" : "+");
}

export function sidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sessions and workspaces" });
}

export function chatPane(page: Page): Locator {
  return page.getByRole("region", { name: "Active chat pane" });
}

export function composer(page: Page): Locator {
  return page.getByRole("combobox", { name: "Message" });
}

export function messages(page: Page): Locator {
  return page.getByRole("region", { name: "Messages", exact: true });
}

export function chatTab(page: Page, name: string): Locator {
  return page
    .getByRole("tablist", { name: "Tabs" })
    .getByRole("tab", { name: new RegExp(`^${name}(, preview)?$`, "u") });
}

export async function setTheme(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  theme: "light" | "dark",
): Promise<void> {
  const page = desktop.page;

  await page.evaluate((value) => {
    const key = "nyte:appearance:v1";
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify(Object.assign({}, stored, { theme: value })));
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
  }, theme);

  await expect(page.locator("html")).toHaveAttribute("data-display-mode", theme);

  await expect
    .poll(() => desktop.application.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
    .toBe(theme);

  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

export function chatRow(page: Page, name: string): Locator {
  return sidebar(page).getByRole("button", { name: new RegExp(`^(Unread )?${name} `, "u") });
}

export async function revealChat(page: Page, name: string): Promise<Locator> {
  const row = chatRow(page, name);
  const more = sidebar(page).getByRole("button", { name: /^Show \d+ More$/u });
  await expect(row.or(more).first()).toBeVisible();

  while (!(await row.isVisible())) await more.first().click();

  return row;
}

export async function openChat(page: Page, name: string): Promise<void> {
  await (await revealChat(page, name)).click();
  await expect(chatTab(page, name)).toHaveAttribute("aria-selected", "true");
}

export async function send(page: Page, text: string): Promise<void> {
  const field = composer(page);
  await field.fill(text);
  await expect(field).toHaveText(text);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await field.press("Enter");
  await expect(field).not.toHaveText(text);
}

export async function clearComposer(page: Page): Promise<void> {
  const field = composer(page);
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await expect(field).toHaveText("");
}

export async function openNewChat(page: Page): Promise<void> {
  await sidebar(page)
    .getByRole("button", { name: `New Chat ${primaryKey} N` })
    .click();
  await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");
  await expect(
    composer(page)
      .and(page.locator('[data-placeholder^="Ask Nyte"]'))
      .or(chatPane(page).locator("[data-composer-chip]")),
  ).toBeVisible();
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The colour every fixture page paints its background, so a window capture tells the page from what draws over it. */
export const PAGE_BACKGROUND = "rgb(255, 0, 170)";

/** Whether a captured pixel is the fixture page's background, allowing for the display's colour space. */
export function paintsPage(color: readonly number[]): boolean {
  const red = color[0] ?? 0;
  const green = color[1] ?? 255;
  const blue = color[2] ?? 0;

  return red > 180 && green < 110 && blue > 90 && blue < 240;
}

/** The `<webview>` guests' pages as main sees them. */
export async function guestPages(
  application: ElectronApplication,
): Promise<readonly { readonly url: string; readonly loading: boolean; readonly title: string }[]> {
  return application.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === "webview")
      .map((contents) => ({
        url: contents.getURL(),
        loading: contents.isLoading(),
        title: contents.getTitle(),
      })),
  );
}

/** Runs a script in the main world of the guest at this address and returns its result as text. */
export async function inGuest(
  application: ElectronApplication,
  url: string,
  script: string,
): Promise<string> {
  return application.evaluate(
    async ({ webContents }, input) => {
      const guest = webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL() === input.url);

      if (guest === undefined) throw new Error(`Guest not found: ${input.url}`);

      return String(await guest.executeJavaScript(input.script, true));
    },
    { url, script },
  );
}

/** Presses a key in the guest at this address through its own contents, as the page's window would, so main's `before-input-event` sees it. */
export async function pressInGuest(
  application: ElectronApplication,
  url: string,
  keyCode: string,
  modifiers: readonly ("meta" | "control" | "shift")[],
): Promise<void> {
  await application.evaluate(
    ({ webContents }, input) => {
      const guest = webContents
        .getAllWebContents()
        .find((item) => item.getType() === "webview" && item.getURL() === input.url);

      if (guest === undefined) throw new Error(`Guest not found: ${input.url}`);
      guest.sendInputEvent({
        type: "keyDown",
        keyCode: input.keyCode,
        modifiers: [...input.modifiers],
      });
      guest.sendInputEvent({
        type: "keyUp",
        keyCode: input.keyCode,
        modifiers: [...input.modifiers],
      });
    },
    { url, keyCode, modifiers },
  );
}

/**
 * Where the app's renderer draws the guest at this address: the box it may paint in, after the slot's clip, and the
 * page's own box, after scaling. Null while the guest is parked or not mounted.
 */
export async function guestBox(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  url: string,
): Promise<{ readonly box: Box; readonly page: Box } | null> {
  const id = await desktop.application.evaluate(
    ({ webContents }, address) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL() === address)
        ?.id ?? -1,
    url,
  );

  return desktop.page.evaluate((wanted) => {
    const attachedId = (element: Electron.WebviewTag): number => {
      try {
        return element.getWebContentsId();
      } catch {
        return -1;
      }
    };

    const element = [...document.querySelectorAll<Electron.WebviewTag>("webview")].find(
      (found) => attachedId(found) === wanted,
    );

    const holder = element?.closest("[data-nyte-browser-guests] > div");

    if (element === undefined || holder === null || holder === undefined) return null;

    if (holder.getAttribute("aria-hidden") === "true") return null;
    const box = holder.getBoundingClientRect();
    const page = element.getBoundingClientRect();

    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      page: { x: page.x, y: page.y, width: page.width, height: page.height },
    };
  }, id);
}

/** The colour the window composites at a point, in CSS px, guests included, as red, green and blue. */
export async function colorAt(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  point: { readonly x: number; readonly y: number },
): Promise<readonly number[]> {
  const window = await desktop.application.browserWindow(desktop.page);

  try {
    return await window.evaluate(async (shown, at) => {
      const image = await shown.webContents.capturePage({
        x: Math.round(at.x) - 1,
        y: Math.round(at.y) - 1,
        width: 3,
        height: 3,
      });

      const size = image.getSize();
      const bitmap = image.toBitmap();
      const middle = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;

      return [bitmap[middle + 2] ?? -1, bitmap[middle + 1] ?? -1, bitmap[middle] ?? -1];
    }, point);
  } finally {
    await window.dispose();
  }
}

/**
 * Saves what the window's renderer composites, guests included, as a PNG. Unlike `captureWindow` it needs no Screen
 * Recording permission, and the vibrancy behind the page stays clear.
 */
export async function captureComposited(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  path: string,
): Promise<{ readonly path: string; readonly contentType: string }> {
  const window = await desktop.application.browserWindow(desktop.page);

  try {
    const png = await window.evaluate(async (shown) =>
      (await shown.webContents.capturePage()).toPNG().toString("base64"),
    );

    await writeFile(path, Buffer.from(png, "base64"));
  } finally {
    await window.dispose();
  }

  return { path, contentType: "image/png" };
}

/** The middle of where two boxes overlap, or null when they don't. */
export function overlapMiddle(left: Box, right: Box): { x: number; y: number } | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;

  if (width < 4 || height < 4) return null;

  return { x: x + width / 2, y: y + height / 2 };
}

export function settingsNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Settings", exact: true });
}

export async function openSettings(page: Page, title: string): Promise<void> {
  if (!(await settingsNav(page).isVisible())) {
    await sidebar(page).getByRole("link", { name: "Settings", exact: true }).click();
  }

  await settingsNav(page).getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

export async function leaveSettings(page: Page): Promise<void> {
  await settingsNav(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
}
