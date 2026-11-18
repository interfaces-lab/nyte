import { expect, test } from "@playwright/test";
import type { ElectronApplication, FrameLocator, Locator, Page, TestInfo } from "@playwright/test";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { launchDesktop } from "./launch.ts";
import { openChat } from "./ui.ts";
import { captureWindow } from "./window-capture.ts";

const SOURCE = `export const first = 1;
export const second = 2;
export const third = 3;
export const fourth = 4;
`;

const FLIP = "Control+Shift+Space";

const SAMPLE = join(import.meta.dirname, "design-sample");

type Problems = ReturnType<typeof collectErrors>;

function apps(page: Page): Locator {
  return page.getByRole("group", { name: "Apps" });
}

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

function editor(page: Page): Locator {
  return workbench(page).getByRole("region", { name: "Editor", exact: true });
}

function board(page: Page): FrameLocator {
  return workbench(page).locator('iframe[title="Design board"]').contentFrame();
}

async function offCentre(page: Page): Promise<number> {
  const frame = await workbench(page).locator('iframe[title="Design board"]').boundingBox();
  const ring = await board(page).locator('[data-ring="you"]').first().boundingBox();

  if (frame === null || ring === null) return Number.POSITIVE_INFINITY;

  return Math.max(
    Math.abs(ring.x + ring.width / 2 - (frame.x + frame.width / 2)),
    Math.abs(ring.y + ring.height / 2 - (frame.y + frame.height / 2)),
  );
}

async function title(application: ElectronApplication, page: Page): Promise<string> {
  return (await application.browserWindow(page)).evaluate((window) => window.getTitle());
}

async function focused(application: ElectronApplication, page: Page): Promise<boolean> {
  return (await application.browserWindow(page)).evaluate((window) => window.isFocused());
}

const LightReply = Type.Object({
  kind: Type.Literal("lights"),
  lights: Type.Object({
    you: Type.Union([
      Type.Object({
        subject: Type.Object({
          kind: Type.String(),
          path: Type.String(),
          start: Type.Optional(Type.Number()),
          end: Type.Optional(Type.Number()),
        }),
      }),
      Type.Null(),
    ]),
  }),
});

async function readLight(page: Page): Promise<Static<typeof LightReply>["lights"]> {
  const reply = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const channel = new BroadcastChannel("nyte:light:v1");
        const timer = setTimeout(() => resolve(null), 2_000);

        channel.addEventListener("message", (event: MessageEvent<unknown>) => {
          clearTimeout(timer);
          channel.close();
          resolve(event.data);
        });
        channel.postMessage({ kind: "ask" });
      }),
  );

  return Value.Parse(LightReply, reply).lights;
}

async function nextWindow(application: ElectronApplication, open: () => Promise<void>) {
  const [page] = await Promise.all([application.waitForEvent("window"), open()]);
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });

  return page;
}

async function offered(page: Page): Promise<readonly string[]> {
  await page.getByRole("button", { name: "New workbench tab" }).click();
  const items = page.getByRole("menu", { name: "New workbench tab" }).getByRole("menuitem");
  await expect(items.first()).toBeVisible();
  const labels = await items.allTextContents();
  await page.keyboard.press("Escape");

  return labels;
}

async function capture(
  testInfo: TestInfo,
  application: ElectronApplication,
  page: Page,
  name: string,
): Promise<void> {
  await testInfo.attach(
    name,
    await captureWindow({ application, page }, testInfo.outputPath(`${name}.png`)),
  );
}

function expectClean(problems: readonly Problems[]): void {
  for (const problem of problems) {
    expect(problem.pageErrors, "uncaught page errors").toEqual([]);
    expect(
      problem.consoleErrors.filter((text) => !text.startsWith("DEV:")),
      "console errors",
    ).toEqual([]);
  }
}

test("Nyte, Code and Studio open on one project, flip with the selection, and come back as their kinds", async () => {
  test.setTimeout(240_000);
  const testInfo = test.info();
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-apps-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const prepared = await prepareHome(parent);
  const appData = join(parent, "app-data");
  const source = join(prepared.home, "apps.ts");
  await writeFile(source, SOURCE);

  await test.step("the first run opens each app beside the one before", async () => {
    const first = await launchDesktop({ home: prepared.home, parentDirectory: parent, appData });

    try {
      const application = first.application;
      const nyte = first.page;
      const problems = [collectErrors(nyte)];

      await openChat(nyte, FIXTURES.beta);
      await expect(apps(nyte).getByRole("button", { name: "Nyte" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect.poll(() => title(application, nyte)).toBe("Nyte — home");

      const code = await nextWindow(application, () =>
        apps(nyte).getByRole("button", { name: "Code" }).click(),
      );

      problems.push(collectErrors(code));

      await test.step("Code opens maximized on the Editor and offers only its tools", async () => {
        await expect.poll(() => title(application, code)).toBe("Nyte Code — home");
        await expect(apps(code).getByRole("button", { name: "Code" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(code.getByRole("button", { name: "Restore split view" })).toBeVisible();
        await expect(editor(code)).toBeVisible();
        await expect(
          code
            .getByRole("tablist", { name: "Workbench tabs" })
            .getByRole("tab", { name: "Editor" }),
        ).toHaveCount(0);
        expect(await offered(code)).toEqual(["Editor", "Changes", "Browser", "Terminal"]);
        await capture(testInfo, application, code, "code-opened");
      });

      await test.step("a selection in Code survives a flip to Nyte and back", async () => {
        await expect(
          editor(code).getByRole("button", { name: "Editor Sidebar", pressed: true }),
        ).toBeVisible();
        await editor(code)
          .getByRole("treeitem", { name: /apps\.ts/u })
          .click();
        const text = editor(code).getByRole("textbox", { name: "apps.ts" });
        await expect(async () => {
          await text.getByText("second", { exact: true }).click();
          await expect(editor(code).getByRole("button", { name: /^Ln 2, Col \d+$/u })).toBeVisible({
            timeout: 1_000,
          });
        }).toPass();
        const from = await text.getByText("second", { exact: true }).boundingBox();
        const to = await text.getByText("third", { exact: true }).boundingBox();

        if (from === null || to === null) throw new Error("The editor drew no lines to select.");
        await code.mouse.move(from.x + 1, from.y + from.height / 2);
        await code.mouse.down();
        await code.mouse.move(to.x + to.width, to.y + to.height / 2, { steps: 8 });
        await code.mouse.up();
        await expect(editor(code).getByRole("button", { name: "2 lines selected" })).toBeVisible();

        const lit = await readLight(nyte);

        expect(lit).toMatchObject({ you: { subject: { kind: "span", path: source } } });

        await code.keyboard.press(FLIP);
        await expect.poll(() => focused(application, nyte)).toBe(true);
        await expect(editor(code).getByRole("button", { name: "2 lines selected" })).toBeVisible();
        await capture(testInfo, application, nyte, "flipped-to-nyte");

        await nyte.keyboard.press(FLIP);
        await expect.poll(() => focused(application, code)).toBe(true);
        await expect(editor(code).getByRole("button", { name: "2 lines selected" })).toBeVisible();
        expect(await readLight(nyte)).toEqual(lit);
        await capture(testInfo, application, code, "flipped-back-to-code");
      });

      const reopened =
        await test.step("a Code window opened by its key lands on the selection", async () => {
          await (await application.browserWindow(code)).evaluate((window) => window.close());
          await expect.poll(() => application.windows().length).toBe(1);

          const landed = await nextWindow(application, () =>
            nyte.keyboard.press("Control+Shift+Digit2"),
          );

          problems.push(collectErrors(landed));
          await expect(
            editor(landed)
              .getByRole("tablist", { name: /^Editor group 1 files/u })
              .getByRole("tab", {
                name: "apps.ts",
              }),
          ).toBeVisible();
          await expect(
            editor(landed).getByRole("button", { name: "2 lines selected" }),
          ).toBeVisible();
          await capture(testInfo, application, landed, "code-landed");

          return landed;
        });

      const empty = await test.step("Studio opens on Design and offers no editor", async () => {
        const studio = await nextWindow(application, () =>
          apps(reopened).getByRole("button", { name: "Studio" }).click(),
        );

        problems.push(collectErrors(studio));
        await expect.poll(() => title(application, studio)).toBe("Nyte Studio — home");
        await expect(apps(studio).getByRole("button", { name: "Studio" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        const tabs = studio.getByRole("tablist", { name: "Workbench tabs" });

        await expect(tabs.getByRole("tab", { name: "Design" })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(tabs.getByRole("tab", { name: "Editor" })).toHaveCount(0);
        await expect(workbench(studio).getByText("No designs yet")).toBeVisible();
        await expect(workbench(studio).getByRole("button", { name: "Ask Nyte" })).toBeVisible();
        await capture(testInfo, application, studio, "studio-opened");
        expect(await offered(studio)).toEqual(["Design"]);

        return studio;
      });

      await test.step("Studio draws the project's designs, and a new Studio window flies to the selection", async () => {
        await (await application.browserWindow(empty)).evaluate((window) => window.close());
        await expect.poll(() => application.windows().length).toBe(2);
        await cp(SAMPLE, join(prepared.home, "design"), { recursive: true });

        const drawn = await nextWindow(application, () =>
          apps(reopened).getByRole("button", { name: "Studio" }).click(),
        );

        problems.push(collectErrors(drawn));
        const designs = workbench(drawn).getByRole("navigation", { name: "Designs" });

        await expect(designs.getByRole("button", { name: "Tonight", exact: true })).toBeVisible();
        await expect(board(drawn).locator('[data-frame="Tonight"]')).toBeVisible();
        await expect(
          board(drawn).getByRole("application", { name: "Design board" }),
        ).not.toHaveAttribute("data-moving");
        await capture(testInfo, application, drawn, "studio-designs");

        await board(drawn).locator('[data-frame="Controls"]').getByText("Not tonight").click();
        await expect(board(drawn).locator('[data-ring="you"]')).toBeVisible();
        await expect(
          designs.getByRole("button", { name: "Controls", exact: true }),
        ).toHaveAttribute("aria-current", "true");
        expect(await readLight(nyte)).toMatchObject({
          you: { subject: { kind: "span", path: join(prepared.home, "design", "controls.jsx") } },
        });
        expect(await offCentre(drawn)).toBeGreaterThan(40);
        await (await application.browserWindow(drawn)).evaluate((window) => window.close());
        await expect.poll(() => application.windows().length).toBe(2);

        const followed = await nextWindow(application, () =>
          apps(reopened).getByRole("button", { name: "Studio" }).click(),
        );

        problems.push(collectErrors(followed));
        await expect(board(followed).locator('[data-ring="you"]')).toBeVisible();
        await expect.poll(() => offCentre(followed)).toBeLessThan(4);
        await expect(
          board(followed).getByRole("application", { name: "Design board" }),
        ).not.toHaveAttribute("data-moving");
        await expect(workbench(followed).getByRole("button", { name: "100%" })).toBeVisible();
        await capture(testInfo, application, followed, "studio-followed-light");
      });

      expectClean(problems);
    } finally {
      await first.close();
    }
  });

  await test.step("a relaunch brings each window back as its kind", async () => {
    const second = await launchDesktop({ home: prepared.home, parentDirectory: parent, appData });

    try {
      const application = second.application;

      await expect.poll(() => application.windows().length).toBe(3);
      const pages = application.windows();
      const problems = pages.map(collectErrors);

      for (const page of pages)
        await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });

      const titles = (): Promise<string[]> =>
        Promise.all(pages.map((page) => title(application, page)));

      await expect
        .poll(titles)
        .toEqual(
          expect.arrayContaining([
            "Nyte Code — home",
            "Nyte Studio — home",
            expect.stringMatching(/^Nyte( — home)?$/u),
          ]),
        );

      const kinds = (await titles()).map((shown, index) => ({
        page: pages[index],
        label: shown.replace(/^Nyte (?=\w)/u, "").split(" — ")[0] ?? "",
      }));

      const code = kinds.find((kind) => kind.label === "Code")?.page;
      const studio = kinds.find((kind) => kind.label === "Studio")?.page;

      if (code === undefined || studio === undefined)
        throw new Error("The relaunch brought Code or Studio back as another kind.");
      await expect(
        workbench(studio)
          .getByRole("navigation", { name: "Designs" })
          .getByRole("button", { name: "Tonight", exact: true }),
      ).toBeVisible();

      for (const kind of kinds) {
        if (kind.page === undefined) continue;
        await expect(apps(kind.page).getByRole("button", { name: kind.label })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await capture(testInfo, application, kind.page, `relaunched-${kind.label.toLowerCase()}`);
      }

      await expect(code.getByRole("button", { name: "Restore split view" })).toBeVisible();
      await expect(editor(code)).toBeVisible();
      await expect(
        code.getByRole("tablist", { name: "Workbench tabs" }).getByRole("tab", { name: "Editor" }),
      ).toHaveCount(0);
      await expect(
        studio
          .getByRole("tablist", { name: "Workbench tabs" })
          .getByRole("tab", { name: "Design" }),
      ).toHaveAttribute("aria-selected", "true");
      expectClean(problems);
    } finally {
      await second.close();
    }
  });
});
