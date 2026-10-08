import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { launchDesktop } from "../../../desktop/benchmark/desktop.ts";
import { collectErrors } from "../utils/errors.ts";

const APP_ROOT = resolve(import.meta.dirname, "../..");

const FILE_SIZE = 64 * 1024;

async function guestPages(application: ElectronApplication) {
  return application.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((contents) => ({
      url: contents.getURL(),
      loading: contents.isLoading(),
      title: contents.getTitle(),
    })),
  );
}

async function guestFocused(application: ElectronApplication, url: string): Promise<boolean> {
  return application.evaluate(
    ({ webContents }, target) =>
      webContents
        .getAllWebContents()
        .some((contents) => contents.getURL() === target && contents.isFocused()),
    url,
  );
}

async function clickGuestControl(
  application: ElectronApplication,
  url: string,
  control: { readonly id: string; readonly name: string; readonly role: "link" | "button" },
): Promise<void> {
  const guest = application.windows().find((window) => window.url() === url);

  if (guest !== undefined) {
    await guest.getByRole(control.role, { name: control.name, exact: true }).click();

    return;
  }

  await application.evaluate(
    async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === input.url);

      if (contents === undefined) throw new Error(`Guest not found: ${input.url}`);
      await contents.executeJavaScript(
        `document.getElementById(${JSON.stringify(input.id)}).click()`,
      );
    },
    { url, id: control.id },
  );
}

/** Input events from main reach the page as trusted keys, so its preload sees them as a user's. */
async function pressInGuest(
  application: ElectronApplication,
  url: string,
  keyCode: string,
  modifiers: readonly ("meta" | "control" | "shift")[],
): Promise<void> {
  await application.evaluate(
    ({ webContents }, input) => {
      const guest = webContents.getAllWebContents().find((item) => item.getURL() === input.url);

      if (guest === undefined) throw new Error(`Guest not found: ${input.url}`);
      guest.focus();
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

test.beforeAll(() => {
  if (!existsSync(resolve(APP_ROOT, "../desktop/out/main/index.js"))) {
    throw new Error("Run pnpm --dir packages/desktop build first");
  }

  if (!existsSync(resolve(APP_ROOT, "dist/index.html"))) {
    throw new Error("Run pnpm --dir packages/app build first");
  }
});

test("integrated browser desktop journey", async () => {
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-browser-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  await symlink(APP_ROOT, join(parent, "app"), "junction");
  const downloadsDirectory = join(parent, "downloads");
  await mkdir(downloadsDirectory);

  let pageRequests = 0;
  let scriptRequests = 0;

  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");

    switch (request.url) {
      case "/":
        pageRequests += 1;
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>First</title></head><body>
          <p>needle needle needle</p>
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
      case "/second":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Second</title></head><body>Second
          <script>if (window.opener) window.opener.postMessage("hello", "*")</script>
        </body></html>`);

        return;
      case "/popup":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Popup flow</title></head><body>
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
          "<!doctype html><html><head><title>Staging home</title></head><body>Staging home</body></html>",
        );

        return;
      case "/history":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          "<!doctype html><html><head><title>Remembered page</title></head><body>Remembered</body></html>",
        );

        return;
      case "/geo":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(`<!doctype html><html><head><title>Location</title></head><body>
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

  const desktop = await launchDesktop({
    parentDirectory: parent,
    downloadsDirectory,
    sessionCount: 0,
  });

  cleanup.defer(() => desktop.close());
  const { application, page } = desktop;
  const errors = collectErrors(page);
  cleanup.defer(async () => {
    await test.info().attach("renderer-errors", {
      body: JSON.stringify({ ...errors, startupPageErrors: desktop.pageErrors }, null, 2),
      contentType: "application/json",
    });
  });
  const panel = page.getByRole("region", { name: "Browser", exact: true });
  const mainWindow = await application.browserWindow(page);
  cleanup.defer(() => mainWindow.dispose());
  const mainWindowId = await mainWindow.evaluate((window) => window.id);

  const navigate = async (path: string): Promise<void> => {
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    await addressField.fill(new URL(path, url).href);
    await addressField.press("Enter");
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
    await openBrowserTab();
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

  await test.step("pause and restore blocking for this host", async () => {
    const loaded = pageRequests;
    await shield.click();

    const hostSwitch = page.getByRole("menuitemcheckbox", {
      name: "Block on 127.0.0.1",
      exact: true,
    });

    await expect(hostSwitch).toBeChecked();
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

  await test.step("open a guest link in a second workbench tab", async () => {
    await clickGuestControl(application, url, { id: "tab", name: "Open second", role: "link" });
    await expect(tabs).toHaveCount(2);
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}second`,
        loading: false,
        title: "Second",
      });
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  });

  await test.step("download into the isolated downloads directory", async () => {
    await clickGuestControl(application, url, { id: "file", name: "Download", role: "link" });
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
    await addressField.press("Meta+f");
    const findBar = panel.getByRole("search", { name: "Find in page" });
    const query = findBar.getByRole("textbox", { name: "Find in page" });
    await query.fill("needle");
    await expect(findBar.getByText("1 of 3", { exact: true })).toBeVisible();
    await query.press("Enter");
    await expect(findBar.getByText("2 of 3", { exact: true })).toBeVisible();
    await query.press("Escape");
    await expect(findBar).toHaveCount(0);
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
    await expect.poll(() => guestFocused(application, popup)).toBe(true);

    if (process.platform === "darwin") {
      await pressInGuest(application, popup, "Left", ["meta"]);
      await expect
        .poll(() => guestPages(application))
        .toContainEqual({ url, loading: false, title: "First" });
    }
  });

  await test.step("open a child popup and receive its opener message", async () => {
    await navigate("/popup");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({
        url: `${url}popup`,
        loading: false,
        title: "Popup flow",
      });
    await clickGuestControl(application, `${url}popup`, {
      id: "popup",
      name: "Open popup",
      role: "button",
    });
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
    await application.evaluate(({ BrowserWindow }, mainId) => {
      const popup = BrowserWindow.getAllWindows().find((window) => window.id !== mainId);

      if (popup === undefined) throw new Error("Popup window not found");
      popup.close();
    }, mainWindowId);
    await expect
      .poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);
  });

  await test.step("answer an HTTP basic auth challenge", async () => {
    await navigate("/auth");
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("127.0.0.1");
    await expect(dialog).toContainText("Staging");
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

  await test.step("recover automatically from a guest renderer crash", async () => {
    const loaded = pageRequests;
    await application.evaluate(async ({ webContents }, guestUrl) => {
      const guest = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === guestUrl);

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
  });

  await test.step("complete a visited address from history in a new tab", async () => {
    const remembered = `${url}history`;
    const host = `127.0.0.1:${String(address.port)}`;
    const typed = `${host}/hi`;
    await navigate("/history");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url: remembered, loading: false, title: "Remembered page" });
    await navigate("/");
    await expect
      .poll(() => guestPages(application))
      .toContainEqual({ url, loading: false, title: "First" });

    await openBrowserTab();
    await expect(tabs).toHaveCount(3);
    const addressField = panel.getByRole("combobox", { name: "Address", exact: true });
    const suggestions = panel.getByRole("listbox", { name: "Suggestions", exact: true });
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
    const suggestions = panel.getByRole("listbox", { name: "Suggestions", exact: true });
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

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(desktop.pageErrors).toEqual([]);
});
