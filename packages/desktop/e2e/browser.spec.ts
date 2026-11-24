import type { ElectronApplication, Locator } from "@playwright/test";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import {
  chatRow,
  clearComposer,
  colorAt,
  composer,
  guestBox,
  guestPages,
  inGuest,
  pressInGuest,
  messages,
  openNewChat,
  overlapMiddle,
  PAGE_BACKGROUND,
  paintsPage,
  revealChat,
  send,
  sidebar,
} from "./ui.ts";

test.use({ chapter: "browser" });

const FILE_SIZE = 64 * 1024;

const soft = expect.configure({ soft: true });

const STYLE = `<style>html { background: ${PAGE_BACKGROUND} }</style>`;

async function clickGuestControl(
  application: ElectronApplication,
  url: string,
  id: string,
): Promise<void> {
  await inGuest(application, url, `document.getElementById(${JSON.stringify(id)}).click()`);
}

async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

test("the integrated browser journey", async ({ desktop }, testInfo) => {
  await using cleanup = new AsyncDisposableStack();
  const downloadsDirectory = desktop.downloads;

  let pageRequests = 0;
  let scriptRequests = 0;

  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");

    switch (request.url) {
      case "/":
        pageRequests += 1;
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>First</title>${STYLE}</head><body>
          <p id="needles">needle needle needle</p>
          <input id="field" autofocus>
          <script src="/adserver.js"></script>
          <a id="tab" href="/second" target="_blank">Open second</a>
          <a id="file" href="/file.bin">Download</a>
        </body></html>`);

        return;
      case "/adserver.js":
        scriptRequests += 1;
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end("");

        return;
      case "/grab":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Grabbing</title>${STYLE}</head><body>
          <input id="field">
          <script>
            const field = document.getElementById("field");
            field.focus();
            setTimeout(() => { field.focus(); document.title = "Grabbed"; }, 500);
          </script>
        </body></html>`);

        return;
      case "/second":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Second</title>${STYLE}</head><body>Second
          <script>if (window.opener) window.opener.postMessage("hello", "*")</script>
        </body></html>`);

        return;
      case "/popup":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Popup flow</title>${STYLE}</head><body>
          <button id="popup" onclick='window.open("/second", "_blank", "width=500,height=600")'>Open popup</button>
          <script>
            window.addEventListener("message", (event) => {
              if (event.data === "hello") document.title = "Got hello";
            });
          </script>
        </body></html>`);

        return;
      case "/auth":
        if (
          request.headers.authorization !== `Basic ${Buffer.from("dev:secret").toString("base64")}`
        ) {
          response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Staging"' });
          response.end();

          return;
        }

        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          `<!doctype html><html><head><title>Staging home</title>${STYLE}</head><body>Staging home</body></html>`,
        );

        return;
      case "/history":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          `<!doctype html><html><head><title>Remembered page</title>${STYLE}</head><body>Remembered</body></html>`,
        );

        return;
      case "/geo":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Location</title>${STYLE}</head><body>
          <script>navigator.geolocation.getCurrentPosition(() => {}, () => {})</script>
        </body></html>`);

        return;
      case "/file.bin":
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="nyte-e2e.bin"',
          "Content-Length": FILE_SIZE,
        });
        response.end(Buffer.alloc(FILE_SIZE, 42));

        return;
      default:
        response.writeHead(204);
        response.end();
    }
  });

  cleanup.defer(async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = Value.Parse(Type.Object({ port: Type.Number() }), server.address());
  const url = `http://127.0.0.1:${String(address.port)}/`;

  const { application, page } = desktop;
  const panel = page.getByRole("region", { name: "Browser", exact: true });
  const mainWindow = await application.browserWindow(page);
  cleanup.defer(() => mainWindow.dispose());
  const mainWindowId = await mainWindow.evaluate((window) => window.id);

  const navigate = async (path: string): Promise<void> => {
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    await addressField.fill(new URL(path, url).href);
    await addressField.press("Enter");
  };

  const shownBox = async (guestUrl: string) => {
    const shown = await guestBox(desktop, guestUrl);

    if (shown === null) throw new Error(`The page at ${guestUrl} is not shown`);

    return shown.box;
  };

  const tabs = page.getByRole("tab", { name: "Browser", exact: true });

  const openBrowserTab = async (): Promise<void> => {
    await page.getByRole("button", { name: "New workbench tab" }).click();
    await page.getByRole("menuitem", { name: "Browser", exact: true }).click();
  };

  const shield = panel
    .getByRole("button")
    .and(panel.getByTitle(/blocked on this page|Paused for/u));

  await test.step("navigate and block the fixture script", async () => {
    await page.getByRole("button", { name: "Open workbench panel", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Workbench" })
      .getByRole("button")
      .filter({ hasText: /^Browser$/u })
      .first()
      .click();
    await expect(panel.getByRole("combobox", { name: "Address", exact: true })).toBeFocused();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await navigate("/");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
    await expect(shield).toHaveAttribute("title", "1 blocked on this page");
    await expect(tabs).toHaveCount(1);
    expect(scriptRequests).toBe(0);
  });

  await test.step("the page shows in its slot, painted by its guest", async () => {
    await expect.poll(() => guestBox(desktop, url)).not.toBeNull();
    const box = await shownBox(url);
    const region = await panel.boundingBox();

    if (region === null) throw new Error("The Browser panel is hidden");
    expect(box.x).toBeGreaterThanOrEqual(region.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width + 1);
    expect(box.y).toBeGreaterThan(region.y);
    expect(box.y + box.height).toBeLessThanOrEqual(region.y + region.height + 1);
    await expect
      .poll(async () =>
        paintsPage(
          await colorAt(desktop, { x: box.x + box.width / 2, y: box.y + box.height - 20 }),
        ),
      )
      .toBe(true);
  });

  await test.step("the shield menu draws over the page, and a press on the page closes it", async () => {
    const menu = page.getByRole("menu");
    await shield.click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Block on 127.0.0.1", exact: true }),
    ).toBeChecked();
    await settled(menu);
    const box = await shownBox(url);
    const menuBox = await menu.boundingBox();

    if (menuBox === null) throw new Error("The shield menu is hidden");
    const over = overlapMiddle(box, menuBox);
    expect(over, "the shield menu overlaps the page").not.toBeNull();

    if (over !== null) expect(paintsPage(await colorAt(desktop, over))).toBe(false);
    await menu.press("Escape");
    await expect(menu).toBeHidden();

    await inGuest(
      application,
      url,
      `window.nytePresses = 0; addEventListener("pointerdown", () => { window.nytePresses += 1 }, true)`,
    );
    await shield.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(box.x + 40, box.y + box.height - 40);
    await expect(menu).toBeHidden();
    expect(await inGuest(application, url, "window.nytePresses")).toBe("1");
    expect(await guestBox(desktop, url)).not.toBeNull();
  });

  await test.step("a toast above the composer leaves the page showing", async () => {
    const row = await revealChat(page, FIXTURES.alpha);
    const archive = sidebar(page).getByRole("button", { name: `Archive ${FIXTURES.alpha}` });
    await expect(async () => {
      await row.hover();
      await archive.click({ timeout: 1000 });
    }).toPass();
    const notice = page.locator('[data-slot="toast"]').filter({ hasText: "1 chat archived" });
    await expect(notice).toBeVisible();
    await notice.hover();
    expect(await guestBox(desktop, url)).not.toBeNull();
    await notice.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const toastBox = await notice.boundingBox();
    const composerBox = await page.getByRole("form", { name: "Message" }).boundingBox();

    if (toastBox === null || composerBox === null) {
      throw new Error("The toast or composer is hidden");
    }
    expect(
      toastBox.x < composerBox.x + composerBox.width &&
        composerBox.x < toastBox.x + toastBox.width &&
        toastBox.y < composerBox.y + composerBox.height &&
        composerBox.y < toastBox.y + toastBox.height,
    ).toBe(false);
    await notice.getByRole("button", { name: "Undo" }).click();
    await expect(notice).toHaveCount(0);
    await expect(chatRow(page, FIXTURES.alpha)).toBeVisible();
  });

  await test.step.skip("pause and restore blocking for this host", async () => {
    const loaded = pageRequests;
    await shield.click();

    const hostSwitch = page.getByRole("menuitemcheckbox", {
      name: "Block on 127.0.0.1",
      exact: true,
    });

    await hostSwitch.click();
    await expect(hostSwitch).not.toBeChecked();
    await expect.poll(() => pageRequests).toBe(loaded + 1);
    await expect.poll(() => scriptRequests).toBe(1);
    await expect(shield).toHaveAttribute("title", "Paused for 127.0.0.1");
    await expect(shield).toHaveText("paused");

    await hostSwitch.click();
    await expect(hostSwitch).toBeChecked();
    await expect.poll(() => pageRequests).toBe(loaded + 2);
    await expect(shield).toHaveAttribute("title", "1 blocked on this page");
    expect(scriptRequests).toBe(1);
    await page.getByRole("menu").press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });

  await test.step("open a guest link in a second workbench tab, and come back without a reload", async () => {
    const loaded = pageRequests;
    await clickGuestControl(application, url, "tab");
    await expect(tabs).toHaveCount(2);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}second`,
        loading: false,
        title: "Second",
      });
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => guestBox(desktop, url)).toBeNull();
    await expect.poll(() => guestBox(desktop, `${url}second`)).not.toBeNull();
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => guestBox(desktop, url)).not.toBeNull();
    expect(await guestBox(desktop, `${url}second`)).toBeNull();
    expect(pageRequests).toBe(loaded);
  });

  await test.step("download into the isolated downloads directory", async () => {
    await clickGuestControl(application, url, "file");
    const downloads = panel.getByRole("status", { name: "Downloads" });
    await expect(downloads.getByText("nyte-e2e.bin", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        stat(join(downloadsDirectory, "nyte-e2e.bin")).then(
          (file) => file.size,
          () => 0,
        ),
      )
      .toBe(FILE_SIZE);
    await expect(downloads.getByText("64 KB", { exact: true })).toBeVisible();
    await expect(downloads.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  });

  await test.step("find and advance through page matches", async () => {
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    await addressField.click();
    await addressField.press("ControlOrMeta+f");
    const findBar = panel.getByRole("search", { name: "Find in page" });
    const query = findBar.getByRole("textbox", { name: "Find in page" });
    await query.fill("needle");
    await expect(findBar.getByText("1 of 3", { exact: true })).toBeVisible();
    await query.press("Enter");
    await expect(findBar.getByText("2 of 3", { exact: true })).toBeVisible();
    await query.press("Escape");
    await expect(findBar).toHaveCount(0);
  });

  await test.step("keys reach the page after a navigation by hand or a click, and stay out of it otherwise", async () => {
    const field = (guestUrl: string) =>
      inGuest(application, guestUrl, 'document.getElementById("field").value');

    const loaded = pageRequests;
    await navigate("/");
    await expect.poll(() => pageRequests).toBe(loaded + 1);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase()))
      .toBe("webview");
    await page.keyboard.type("typed");
    await expect.poll(() => field(url)).toBe("typed");

    await composer(page).click();
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type("draft");
    await expect(composer(page)).toContainText("draft");
    expect(await field(url)).toBe("typed");

    const box = await shownBox(url);

    const fieldBox = Value.Parse(
      Type.Object({ x: Type.Number(), y: Type.Number() }),
      JSON.parse(
        await inGuest(
          application,
          url,
          'JSON.stringify((({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 }))(document.getElementById("field").getBoundingClientRect()))',
        ),
      ),
    );

    await page.mouse.click(box.x + fieldBox.x, box.y + fieldBox.y);
    await page.keyboard.type(" clicked");
    await expect.poll(() => field(url)).toBe("typed clicked");
    await expect(composer(page)).not.toContainText("clicked");
    await clearComposer(page);

    const grab = `${url}grab`;
    await composer(page).click();
    await application.evaluate(
      ({ webContents }, input) => {
        const guest = webContents
          .getAllWebContents()
          .find((item) => item.getType() === "webview" && item.getURL() === input.url);

        if (guest === undefined) throw new Error(`Guest not found: ${input.url}`);
        void guest.loadURL(input.grab);
      },
      { url, grab },
    );
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: grab, loading: false, title: "Grabbed" });
    await page.keyboard.type("kept");
    await expect(composer(page)).toContainText("kept");
    expect(await field(grab)).toBe("");
    await clearComposer(page);
    await navigate("/");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
  });

  await test.step("drive the focused page with browser shortcuts", async () => {
    const primary = process.platform === "darwin" ? "meta" : "control";
    const popup = `${url}popup`;
    await navigate("/popup");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: popup, loading: false, title: "Popup flow" });
    await page.evaluate(() => {
      document.documentElement.dataset["e2eRenderer"] = "kept";
    });

    await pressInGuest(application, popup, "[", [primary]);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });

    const loaded = pageRequests;
    await pressInGuest(application, url, "r", [primary]);
    await expect.poll(() => pageRequests).toBe(loaded + 1);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
    expect(await page.evaluate(() => document.documentElement.dataset["e2eRenderer"])).toBe("kept");

    await pressInGuest(application, url, "]", [primary]);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: popup, loading: false, title: "Popup flow" });

    await pressInGuest(application, popup, "l", [primary]);
    await expect(panel.getByRole("combobox", { name: "Address", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(panel.getByRole("combobox", { name: "Address", exact: true })).not.toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase()))
      .toBe("webview");

    if (process.platform === "darwin") {
      await pressInGuest(application, popup, "Left", ["meta"]);
      await expect
        .poll(() => guestPages(application))
        .toContainEqual({ url, loading: false, title: "First" });
    }
  });

  await test.step("a drag of the workbench's handle keeps going across the page", async () => {
    const workbench = page.getByRole("complementary", { name: "Workbench" });
    const handle = workbench.getByRole("separator", { name: "Resize workbench" });

    const section = workbench
      .locator("section")
      .filter({ has: page.getByRole("separator", { name: "Resize workbench" }) });

    const before = await section.boundingBox();
    const grip = await handle.boundingBox();

    if (before === null || grip === null) throw new Error("The workbench's handle is hidden");
    const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 160, start.y, { steps: 8 });
    await page.mouse.up();
    const grown = await section.boundingBox();
    const moved = await handle.boundingBox();

    if (grown === null || moved === null) throw new Error("The workbench is hidden");
    const growth = grown.width - before.width;
    soft(growth).toBeGreaterThan(40);

    const pageBox = await shownBox(url);
    const from = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
    soft(from.y).toBeGreaterThan(pageBox.y);
    soft(pageBox.x).toBeLessThan(from.x + growth / 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + growth, from.y, { steps: 8 });
    await page.mouse.up();
    const after = await section.boundingBox();
    soft(after?.width ?? 0).toBeCloseTo(before.width, -1);
  });

  await test.step("open a hardened child popup and receive its opener message", async () => {
    await navigate("/popup");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}popup`,
        loading: false,
        title: "Popup flow",
      });
    await clickGuestControl(application, `${url}popup`, "popup");
    await expect
      .poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(2);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}popup`,
        loading: false,
        title: "Got hello",
      });

    const child = await application.evaluate(
      async ({ BrowserWindow, webContents }, input) => {
        const popup = BrowserWindow.getAllWindows().find((window) => window.id !== input.mainId);

        const opener = webContents
          .getAllWebContents()
          .find((item) => item.getType() === "webview" && item.getURL() === input.opener);

        if (popup === undefined) throw new Error("Popup window not found");

        const node = String(
          await popup.webContents.executeJavaScript("typeof require + ' ' + typeof process"),
        );

        const parent = popup.getParentWindow()?.id;
        const session = popup.webContents.session === opener?.session;
        popup.close();

        return { parent, node, session };
      },
      { mainId: mainWindowId, opener: `${url}popup` },
    );

    soft(child).toEqual({ parent: mainWindowId, node: "undefined undefined", session: true });
    await expect
      .poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);
  });

  await test.step("answer an HTTP basic auth challenge in a dialog over the page", async () => {
    await navigate("/auth");
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("127.0.0.1");
    await expect(dialog).toContainText("Staging");
    await settled(dialog);
    const dialogBox = await dialog.boundingBox();

    const box = await page
      .locator("[data-nyte-browser-guests] > div:not([aria-hidden])")
      .boundingBox();

    if (dialogBox === null || box === null) throw new Error("The dialog or the page is hidden");
    const over = overlapMiddle(box, dialogBox);
    soft(over, "the sign-in dialog overlaps the page").not.toBeNull();

    if (over !== null) {
      soft(paintsPage(await colorAt(desktop, over)), "the page paints over the dialog").toBe(false);
    }
    await dialog.getByLabel("Username", { exact: true }).fill("dev");
    await dialog.getByLabel("Password", { exact: true }).fill("secret");
    await dialog.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}auth`,
        loading: false,
        title: "Staging home",
      });
    await expect(dialog).toBeHidden();
  });

  await test.step("show a denied permission and clear it on navigation", async () => {
    await navigate("/geo");

    const blockedLocation = panel.getByRole("img", {
      name: "Blocked by Nyte: Location",
      exact: true,
    });

    await expect(blockedLocation).toBeVisible();
    await navigate("/");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
    await expect(blockedLocation).toHaveCount(0);
  });

  await test.step("Design Mode picks an element of the page into the composer", async () => {
    const toggle = panel.getByRole("button", { name: "Design Mode", exact: true });
    const chips = page.locator('[data-composer-chip="excerpt"]');
    const before = await chips.count();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("button", { name: "Exit Design Mode", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        inGuest(
          application,
          url,
          '[...document.documentElement.children].some((element) => getComputedStyle(element).cursor === "crosshair")',
        ),
      )
      .toBe("true");
    const box = await shownBox(url);

    const needles = Value.Parse(
      Type.Object({ x: Type.Number(), y: Type.Number() }),
      JSON.parse(
        await inGuest(
          application,
          url,
          'JSON.stringify((({ x, y, height }) => ({ x: x + 10, y: y + height / 2 }))(document.getElementById("needles").getBoundingClientRect()))',
        ),
      ),
    );

    await page.mouse.move(box.x + needles.x + 40, box.y + needles.y + 40);
    await page.mouse.move(box.x + needles.x, box.y + needles.y, { steps: 4 });
    await page.mouse.click(box.x + needles.x, box.y + needles.y);
    await soft(chips, "a pick from the page in the composer").toHaveCount(before + 1);
    await expect(composer(page)).toBeFocused();
    await panel.getByRole("button", { name: "Exit Design Mode", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("recover automatically from a guest renderer crash, and take input again", async () => {
    const loaded = pageRequests;

    const guestId = () =>
      application.evaluate(
        ({ webContents }, guestUrl) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getType() === "webview" && contents.getURL() === guestUrl)
            ?.id ?? -1,
        url,
      );

    const crashedId = await guestId();
    await application.evaluate(async ({ webContents }, guestUrl) => {
      const guest = webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL() === guestUrl);

      if (guest === undefined) throw new Error(`Guest not found: ${guestUrl}`);

      const crashed = new Promise<void>((resolveCrash) => {
        guest.once("render-process-gone", () => resolveCrash());
      });

      guest.forcefullyCrashRenderer();
      await crashed;
    }, url);
    await expect.poll(() => pageRequests).toBe(loaded + 1);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });
    await expect(panel.getByRole("button", { name: "Try Again", exact: true })).toHaveCount(0);
    testInfo.annotations.push({
      type: "guest after the crash",
      description: (await guestId()) === crashedId ? "same guest" : "new guest",
    });

    await expect.poll(() => guestBox(desktop, url)).not.toBeNull();
    await inGuest(
      application,
      url,
      `window.nytePresses = 0; addEventListener("pointerdown", () => { window.nytePresses += 1 }, true)`,
    );
    const box = await shownBox(url);
    await page.mouse.click(box.x + 40, box.y + box.height - 40);
    await soft
      .poll(() => inGuest(application, url, "window.nytePresses"), {
        message: "a press reaches the page after the crash",
      })
      .toBe("1");

    const field = Value.Parse(
      Type.Object({ x: Type.Number(), y: Type.Number() }),
      JSON.parse(
        await inGuest(
          application,
          url,
          'JSON.stringify((({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 }))(document.getElementById("field").getBoundingClientRect()))',
        ),
      ),
    );

    await page.mouse.click(box.x + field.x, box.y + field.y);
    await page.keyboard.type("again");
    await soft
      .poll(() => inGuest(application, url, 'document.getElementById("field").value'), {
        message: "keys reach the page after a click after the crash",
      })
      .toBe("again");
  });

  await test.step("complete a visited address from history in a new tab", async () => {
    const remembered = `${url}history`;
    const host = `127.0.0.1:${String(address.port)}`;
    const typed = `${host}/hi`;
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    const suggestions = page.getByRole("listbox", { name: "Suggestions", exact: true });
    await navigate("/history");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: remembered, loading: false, title: "Remembered page" });
    await navigate("/");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });

    await addressField.click();
    await addressField.press("ControlOrMeta+a");
    await addressField.pressSequentially(host);
    await expect(suggestions).toBeVisible();
    await settled(suggestions);
    const listBox = await suggestions.boundingBox();
    const box = await shownBox(url);

    if (listBox === null) throw new Error("The suggestions are hidden");
    const over = overlapMiddle(box, listBox);
    soft(over, "the suggestions overlap the page").not.toBeNull();

    if (over !== null) {
      soft(paintsPage(await colorAt(desktop, over)), "the page paints over the suggestions").toBe(
        false,
      );
    }
    await addressField.press("Escape");
    await addressField.press("Escape");
    await expect(suggestions).toBeHidden();

    await openBrowserTab();
    await expect(tabs).toHaveCount(3);
    await expect(addressField).toBeFocused();
    await expect(suggestions.getByRole("option", { name: /^Remembered page/u })).toBeVisible();

    await addressField.pressSequentially(typed);
    await expect(addressField).toHaveValue(`${host}/history`);
    await expect
      .poll(() =>
        addressField.evaluate((field) =>
          field instanceof HTMLInputElement ? [field.selectionStart, field.selectionEnd] : [],
        ),
      )
      .toEqual([typed.length, typed.length + "story".length]);
    await expect(
      suggestions.getByRole("option", { name: `Go to ${host}/history`, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await addressField.press("Enter");
    await expect(suggestions).toBeHidden();
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: remembered, loading: false, title: "Remembered page" });
  });

  await test.step("reopen a recent page after its tab closed", async () => {
    const remembered = `${url}history`;

    const visits = async () =>
      (await guestPages(application)).filter((guest) => guest.url === remembered).length;

    await tabs.last().press("Delete");
    await expect(tabs).toHaveCount(2);
    await expect.poll(visits).toBe(0);

    await openBrowserTab();
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    const suggestions = page.getByRole("listbox", { name: "Suggestions", exact: true });
    await expect(addressField).toBeFocused();
    await expect(suggestions.getByRole("option").first()).toHaveAccessibleName(/^Remembered page/u);
    await addressField.press("ArrowDown");
    await expect(addressField).toHaveValue(remembered);
    await addressField.press("Enter");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: remembered, loading: false, title: "Remembered page" });
    await expect.poll(visits).toBe(1);
  });
});

test("an agent captures a page that no Browser tab shows", async ({ desktop }) => {
  await using cleanup = new AsyncDisposableStack();

  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      "<!doctype html><html><head><title>Agent page</title></head><body>Agent page</body></html>",
    );
  });

  cleanup.defer(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = Value.Parse(Type.Object({ port: Type.Number() }), server.address());
  const { page } = desktop;

  await openNewChat(page);
  await send(page, `/browse http://127.0.0.1:${String(address.port)}/`);

  const reply = messages(page).getByText(/^Viewport /);
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await expect(reply).not.toContainText('"0x0"');
  await expect(reply).toContainText("Capture returned an image.");
});
