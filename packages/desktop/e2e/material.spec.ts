import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "./desk.ts";
import type { Desk, DeskApp } from "./desk.ts";
import { screenLocked } from "./window-capture.ts";

const KINDS: readonly DeskApp[] = ["Nyte", "Code", "Studio"];

const SAME_CHROME = 4;

const SHOWS_THROUGH = 6;

const LINE_TOLERANCE = 1;

const BACKDROPS = { red: "#ff0000", blue: "#0000ff" } as const;

const ROUNDS = [
  { round: 1, theme: "light" },
  { round: 2, theme: "dark" },
  { round: 3, theme: "light" },
] as const;

const run = promisify(execFile);

type Backdrop = keyof typeof BACKDROPS;

interface Point {
  readonly x: number;
  readonly y: number;
}

test.use({ opened: ["Code", "Studio"] });

test.skip(process.platform !== "darwin", "The vibrancy and the traffic lights are drawn by macOS.");

test.beforeEach(async () => {
  test.skip(
    await screenLocked(),
    "The screen is locked, so the window server draws no window to measure.",
  );
});

test("every window kind fills its titlebar with the material, blends what is behind it through, and draws it the same after a change of appearance", async ({
  desk,
}) => {
  const first = new Map<DeskApp, readonly number[]>();

  for (const round of ROUNDS) {
    const theme = round.theme;

    await desk.setTheme(theme);

    for (const app of KINDS) {
      const page = desk.page(app);
      const point = await bareChrome(page);
      const name = `material-${String(round.round)}-${theme}-${app.toLowerCase()}`;

      await expect(async () => {
        const own = await pixel(desk.application, await desk.capture(page, name), page, point);

        expect(own[3], `the material fills ${app}'s titlebar behind its clear backing`).toBe(255);
        expect(luma(own) > 128, `${app}'s material is ${theme}`).toBe(theme === "light");

        const red = await onScreen(desk, page, "red", point, `${name}-over-red`);
        const blue = await onScreen(desk, page, "blue", point, `${name}-over-blue`);

        expect(
          Math.max(
            ...[0, 1, 2].map((channel) => Math.abs((red[channel] ?? 0) - (blue[channel] ?? 0))),
          ),
          `${app}'s titlebar blends the window behind it`,
        ).toBeGreaterThanOrEqual(SHOWS_THROUGH);

        const before = first.get(app);

        if (before === undefined) {
          first.set(app, own);

          return;
        }

        if (theme !== "light") return;

        for (const channel of [0, 1, 2])
          expect(
            Math.abs((own[channel] ?? 0) - (before[channel] ?? 255)),
            `${app}'s material back in light`,
          ).toBeLessThanOrEqual(SAME_CHROME);
      }).toPass({ timeout: 15_000 });
    }
  }
});

test("the traffic lights stay on the titlebar's line when a window shows, loses and gains the keyboard, and changes appearance", async ({
  desk,
}) => {
  const moments = [
    { name: "shown", act: async (): Promise<void> => undefined },
    { name: "blurred", act: (app: DeskApp) => focusOther(desk, app) },
    { name: "focused", act: (app: DeskApp) => desk.front(desk.page(app)) },
    { name: "light", act: () => desk.setTheme("light") },
    { name: "dark", act: () => desk.setTheme("dark") },
    { name: "dark-again", act: () => desk.setTheme("dark") },
    { name: "light-again", act: () => desk.setTheme("light") },
  ];

  for (const moment of moments)
    for (const app of KINDS) {
      const page = desk.page(app);

      await moment.act(app);
      const line = await titleLine(page);

      await expect(async () => {
        const path = await desk.capture(page, `lights-${moment.name}-${app.toLowerCase()}`);
        const centre = await lightsCentre(desk.application, path, page);

        expect(
          Math.abs(centre - line),
          `${app}'s lights at ${String(centre)} when ${moment.name}, its title line at ${String(line)}`,
        ).toBeLessThanOrEqual(LINE_TOLERANCE);
      }).toPass({ timeout: 10_000 });
    }
});

async function onScreen(
  desk: Desk,
  page: Page,
  backdrop: Backdrop,
  point: Point,
  name: string,
): Promise<readonly number[]> {
  const target = await (await desk.application.browserWindow(page)).evaluate((window) => window.id);
  const path = test.info().outputPath(`${name}.png`);

  const placed = await desk.application.evaluate(
    (electron, input) => {
      const window = electron.BrowserWindow.fromId(input.target);

      if (window === null) throw new Error("The window to put a backdrop behind is gone.");
      const bounds = window.getBounds();

      const behind = new electron.BrowserWindow({
        ...bounds,
        backgroundColor: input.color,
        frame: false,
        hasShadow: false,
        focusable: false,
        show: false,
      });

      behind.setAlwaysOnTop(true, "floating");
      window.setAlwaysOnTop(true, "floating", 1);
      behind.showInactive();
      window.moveTop();

      return { id: behind.id, bounds };
    },
    { target, color: BACKDROPS[backdrop] },
  );

  try {
    const bounds = placed.bounds;

    await run("screencapture", [
      "-x",
      `-R${String(bounds.x)},${String(bounds.y)},${String(bounds.width)},${String(bounds.height)}`,
      path,
    ]);
    await test.info().attach(name, { path, contentType: "image/png" });

    return await pixel(desk.application, path, page, point);
  } finally {
    await desk.application.evaluate(
      (electron, input) => {
        electron.BrowserWindow.fromId(input.target)?.setAlwaysOnTop(false);
        electron.BrowserWindow.fromId(input.behind)?.destroy();
      },
      { target, behind: placed.id },
    );
  }
}

async function focusOther(desk: Desk, app: DeskApp): Promise<void> {
  const other = KINDS.find((kind) => kind !== app) ?? "Nyte";
  await (
    await desk.application.browserWindow(desk.page(other))
  ).evaluate((window) => window.focus());
  await expect
    .poll(async () =>
      (await desk.application.browserWindow(desk.page(app))).evaluate((window) =>
        window.isFocused(),
      ),
    )
    .toBe(false);
}

async function titleLine(page: Page): Promise<number> {
  const header = await page.locator("header").first().boundingBox();

  if (header === null) throw new Error("The window has no titlebar.");

  return header.y + header.height / 2;
}

async function bareChrome(page: Page): Promise<Point> {
  const apps = await page.getByRole("group", { name: "Apps" }).boundingBox();

  if (apps === null) throw new Error("The titlebar is not drawn.");

  return { x: apps.x + apps.width + 8, y: await titleLine(page) };
}

function luma(color: readonly number[]): number {
  return ((color[0] ?? 0) + (color[1] ?? 0) + (color[2] ?? 0)) / 3;
}

async function pixel(
  application: ElectronApplication,
  path: string,
  page: Page,
  point: Point,
): Promise<readonly number[]> {
  const width = await page.evaluate(() => innerWidth);

  return application.evaluate(
    (electron, input) => {
      const image = electron.nativeImage.createFromPath(input.path);
      const size = image.getSize();
      const scale = size.width / input.width;
      const at = (Math.round(input.y * scale) * size.width + Math.round(input.x * scale)) * 4;

      return [...image.toBitmap().subarray(at, at + 4)];
    },
    { path, x: point.x, y: point.y, width },
  );
}

async function lightsCentre(
  application: ElectronApplication,
  path: string,
  page: Page,
): Promise<number> {
  const width = await page.evaluate(() => innerWidth);

  return application.evaluate(
    (electron, input) => {
      const image = electron.nativeImage.createFromPath(input.path);
      const size = image.getSize();
      const scale = size.width / input.width;
      const pixels = image.toBitmap();
      const bare = Math.round(6 * scale);
      const strip = Array.from({ length: 20 }, (_, step) => Math.round((16 + step) * scale));

      const rows = Array.from(
        { length: Math.round(34 * scale) },
        (_, y) => y + Math.round(6 * scale),
      ).filter((y) =>
        strip.some((x) =>
          [0, 1, 2].some(
            (channel) =>
              Math.abs(
                (pixels[(y * size.width + x) * 4 + channel] ?? 0) -
                  (pixels[(y * size.width + bare) * 4 + channel] ?? 0),
              ) > 8,
          ),
        ),
      );

      return ((rows[0] ?? 0) + (rows.at(-1) ?? 0) + 1) / 2 / scale;
    },
    { path, width },
  );
}
