import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import electronExecutable from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterAll, beforeAll, test } from "vitest";

const desktop = fileURLToPath(new URL("../../../desktop/", import.meta.url));

let directory: string | undefined;

let application: ElectronApplication;

let page: Page;

beforeAll(async () => {
  const executablePath = Value.Parse(Type.String(), electronExecutable);
  const root = await mkdtemp(join(tmpdir(), "nyte-titlebar-"));
  directory = root;
  await mkdir(join(root, "home"));
  await mkdir(join(root, "app-data"));
  await symlink(join(desktop, "resources"), join(root, "resources"), "dir");
  // The renderer is served from the app path, which is this directory.
  await symlink(join(desktop, "out"), join(root, "out"), "dir");
  execFileSync("pnpm", ["exec", "electron-vite", "build"], {
    cwd: desktop,
    timeout: 180_000,
    stdio: "pipe",
  });
  const entry = join(root, "main.cjs");
  await writeFile(
    entry,
    `const { app } = require("electron");\napp.setPath("appData", ${JSON.stringify(join(root, "app-data"))});\nrequire(${JSON.stringify(join(desktop, "out/main/index.js"))});\n`,
  );

  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== "ELECTRON_RUN_AS_NODE" &&
        entry[0] !== "ELECTRON_RENDERER_URL",
    ),
  );

  application = await _electron.launch({
    executablePath,
    args: [entry],
    cwd: desktop,
    env: { ...inherited, HOME: join(root, "home"), NYTE_HOME: join(root, "home/.nyte") },
    timeout: 60_000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).waitFor();
}, 240_000);

afterAll(async () => {
  await application?.close();

  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

async function geometry() {
  return page.evaluate(() => {
    const header = document.querySelector("header");

    const toggle = document.querySelector(
      'button[aria-label="Hide sidebar"], button[aria-label="Show sidebar"]',
    );

    const back = document.querySelector('button[aria-label="Go back"]');
    const forward = document.querySelector('button[aria-label="Go forward"]');
    const workbenchToggle = document.getElementById("workbench-toggle");

    const workbench = document.querySelector(
      'aside[aria-label="Workbench"] > section:not([hidden])',
    );

    if (!header || !toggle || !workbenchToggle) throw new Error("Missing window chrome");

    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();

      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        centerY: rect.top + rect.height / 2,
      };
    };

    return {
      header: box(header),
      toggle: box(toggle),
      back: back ? box(back) : null,
      forward: forward ? box(forward) : null,
      track: box(workbenchToggle.parentElement?.parentElement ?? workbenchToggle),
      workbench: workbench ? box(workbench) : null,
      zoom: Number(
        getComputedStyle(document.documentElement).getPropertyValue("--nyte-window-zoom"),
      ),
    };
  });
}

async function setZoom(zoom: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, factor) => {
    const window = BrowserWindow.getAllWindows()[0];

    if (!window) throw new Error("Missing Nyte window");
    window.webContents.setZoomFactor(factor);
  }, zoom);
  await expect.poll(async () => (await geometry()).zoom).toBeCloseTo(zoom, 5);
}

test("titlebar controls and workbench stay aligned at every zoom and on every display", async () => {
  await page.getByRole("button", { name: "Open workbench panel", exact: true }).click();
  await page.getByRole("button", { name: "Close workbench panel", exact: true }).waitFor();

  const displays = await application.evaluate(({ screen }) =>
    screen.getAllDisplays().map((display) => ({
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      scaleFactor: display.scaleFactor,
    })),
  );

  for (const display of displays) {
    await application.evaluate(({ BrowserWindow }, target) => {
      const window = BrowserWindow.getAllWindows()[0];

      if (!window) throw new Error("Missing Nyte window");
      window.setPosition(target.x, target.y);
      window.setSize(Math.min(1200, target.width), 800);
    }, display);

    for (const zoom of [0.5, 0.67, 0.8, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      await setZoom(zoom);
      await expect
        .poll(async () => {
          const measured = await geometry();

          return measured.workbench === null
            ? Infinity
            : Math.abs(measured.track.left - measured.workbench.left);
        })
        .toBeLessThanOrEqual(1);
      const measured = await geometry();
      assert.ok(Math.abs(measured.toggle.centerY - measured.header.centerY) < 0.1);
      assert.ok(measured.back && measured.forward);
      assert.ok(measured.back.left - measured.toggle.right >= 7.9);
      assert.ok(Math.abs(measured.back.centerY - measured.header.centerY) < 0.1);
      assert.ok(Math.abs(measured.forward.centerY - measured.header.centerY) < 0.1);
      assert.ok(measured.forward.left - measured.back.right >= 7.9);

      if (process.platform === "darwin") {
        const native = await application.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];

          if (!window) throw new Error("Missing Nyte window");

          return window.getWindowButtonPosition();
        });

        assert.ok(native);
        assert.ok(measured.toggle.left * zoom >= 71.9);
        assert.ok(Math.abs(measured.header.centerY * zoom - (native.y + 7.5)) <= 1);
      }
    }
  }

  await setZoom(1);
}, 90_000);

test("chrome stages restore their tabs on refresh and history navigation", async () => {
  const sidebar = page.getByRole("navigation", { name: "Sessions and workspaces" });
  await sidebar.getByRole("button", { name: "Customize", exact: true }).click();
  const customize = page.getByRole("tablist", { name: "Customize inventory" });
  await customize.getByRole("tab", { name: "Skills", exact: true }).click();
  await expect(customize.getByRole("tab", { name: "Skills", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.reload();
  await expect(
    page
      .getByRole("tablist", { name: "Customize inventory" })
      .getByRole("tab", { name: "Skills", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await sidebar.getByRole("button", { name: "Environments", exact: true }).click();
  const remoteAccess = page.getByRole("heading", { name: "Remote access", exact: true });
  await expect(remoteAccess).toBeVisible();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(
    page
      .getByRole("tablist", { name: "Customize inventory" })
      .getByRole("tab", { name: "Skills", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(remoteAccess).toBeVisible();
  await page.reload();
  await expect(remoteAccess).toBeVisible();
}, 60_000);
