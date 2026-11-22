import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "./fixtures.ts";
import {
  captureComposited,
  colorAt,
  composer,
  guestBox,
  inGuest,
  pressInGuest,
  overlapMiddle,
  PAGE_BACKGROUND,
  paintsPage,
  primaryKey,
  sidebar,
} from "./ui.ts";
import type { Box } from "./ui.ts";
import type { Locator, Page } from "@playwright/test";

test.use({ chapter: "design" });

const SAMPLE = join(import.meta.dirname, "design-sample");

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

test("a live page frame loads once selected, follows the board's camera, takes input once entered, and works with Design Mode", async ({
  desktop,
}, testInfo) => {
  await using cleanup = new AsyncDisposableStack();
  const page = desktop.page;
  const application = desktop.application;
  const project = join(desktop.home, "studio");
  const designs = join(project, "design");
  const requests = new Map<string, number>();

  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.set(path, (requests.get(path) ?? 0) + 1);

    if (path !== "/") {
      response.writeHead(204);
      response.end();

      return;
    }

    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end(`<!doctype html><html><head><title>Live page</title>
      <style>html { background: ${PAGE_BACKGROUND} } body { margin: 0; min-height: 3000px }
      #title, #field { position: fixed; left: 40%; margin: 0 } #title { top: 30% } #field { top: 50% }</style>
      </head><body><h1 id="title">Live page</h1><input id="field"></body></html>`);
  });

  cleanup.defer(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = Value.Parse(Type.Object({ port: Type.Number() }), server.address()).port;
  const url = `http://127.0.0.1:${String(port)}/`;

  const capture = async (name: string): Promise<void> => {
    await testInfo.attach(
      name,
      await captureComposited(desktop, testInfo.outputPath(`${name}.png`)),
    );
  };

  await cp(SAMPLE, designs, { recursive: true });
  await mkdir(join(project, ".agents", "skills", "studio"), { recursive: true });
  await writeFile(
    join(project, ".agents", "skills", "studio", "SKILL.md"),
    "---\nname: studio\ndescription: Draws the studio's designs.\n---\n\nDraw designs under design/.\n",
  );

  const sheet = join(designs, "blocks", "phase-card.jsx");

  const frames = [
    `      <div data-frame="Live page" data-x="0" data-y="700" data-page="${url}" style={{ width: 800, height: 600 }} />`,
    `      <div data-frame="Computed page" data-x="900" data-y="700" data-page={"${url}" + "expr"} style={{ width: 400, height: 300 }} />`,
  ];

  await writeFile(
    sheet,
    (await readFile(sheet, "utf8")).replace(
      "  return (\n    <>\n",
      `  return (\n    <>\n${frames.join("\n")}\n`,
    ),
  );
  expect(await readFile(sheet, "utf8")).toContain('data-frame="Live page"');
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, project);
  await sidebar(page)
    .getByRole("button", { name: `Search ${primaryKey} K` })
    .click();
  await page
    .getByRole("dialog", { name: "Search chats and actions" })
    .getByRole("option", { name: `Open Folder… ${primaryKey} O`, exact: true })
    .click();
  const trustDialog = page.getByRole("dialog", { name: "Trust Folder" });
  await expect(trustDialog).toContainText(project);
  await trustDialog.getByRole("button", { name: "Trust Folder" }).click();
  await expect(trustDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "studio", exact: true })).toBeVisible();
  const openPanel = page.getByRole("button", { name: "Open workbench panel" });
  await expect(
    openPanel.or(page.getByRole("button", { name: "Close workbench panel" })),
  ).toBeVisible();

  if (await openPanel.isVisible()) await openPanel.click();
  const designTab = page.getByRole("tab", { name: "Design", exact: true });

  await designTab
    .or(workbench(page).getByRole("button", { name: "Design", exact: true }))
    .first()
    .click();

  const board = workbench(page).locator('iframe[title="Design board"]').contentFrame();
  const stage = board.getByRole("application", { name: "Design board" });
  const list = workbench(page).getByRole("navigation", { name: "Designs" });
  const showList = workbench(page).getByRole("button", { name: "Show designs" });

  const live = board.locator('[data-frame-box]:has([data-name="Live page"])');
  const computed = board.locator('[data-frame-box]:has([data-name="Computed page"])');

  const cover = live.locator("[data-page-cover]");
  const designMode = workbench(page).getByRole("button", { name: "Design Mode", exact: true });
  const zoomButton = workbench(page).getByRole("button", { name: /^\d+%$/u });
  const shownGuest = page.locator("[data-nyte-browser-guests] > div:not([aria-hidden])");

  const measure = async (locator: Locator): Promise<Box> => {
    const box = await locator.boundingBox();

    if (box === null) throw new Error("The element is not on screen.");

    return box;
  };

  const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

  const pageBackground = (box: Box) => ({
    x: box.x + box.width * 0.85,
    y: box.y + box.height * 0.85,
  });

  const shownPage = async (): Promise<Box> => {
    const shown = await guestBox(desktop, url);

    if (shown === null) throw new Error("The live page is not shown.");

    return shown.page;
  };

  const pagePoint = async (id: string) => {
    const shown = await shownPage();

    const inside = Value.Parse(
      Type.Object({ x: Type.Number(), y: Type.Number() }),
      JSON.parse(
        await inGuest(
          application,
          url,
          `JSON.stringify((({ x, y, width, height }) => ({ x: x + Math.min(20, width / 2), y: y + height / 2 }))(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect()))`,
        ),
      ),
    );

    const scale = shown.width / 800;

    return { x: shown.x + inside.x * scale, y: shown.y + inside.y * scale };
  };

  const aligned = async (): Promise<boolean> => {
    const shown = await guestBox(desktop, url);
    const frame = await live.boundingBox();

    return (
      shown !== null &&
      frame !== null &&
      Math.abs(shown.page.x - frame.x) < 2 &&
      Math.abs(shown.page.y - frame.y) < 2 &&
      Math.abs(shown.page.width - frame.width) < 2 &&
      Math.abs(shown.page.height - frame.height) < 2
    );
  };

  const wheel = async (
    at: { readonly x: number; readonly y: number },
    delta: { readonly x: number; readonly y: number },
    modifier?: "Control" | "Meta",
  ): Promise<void> => {
    await page.mouse.move(at.x, at.y);

    if (modifier !== undefined) await page.keyboard.down(modifier);
    await page.mouse.wheel(delta.x, delta.y);

    if (modifier !== undefined) await page.keyboard.up(modifier);
  };

  const zoomRatio = async (
    at: { readonly x: number; readonly y: number },
    deltaY: number,
  ): Promise<number> => {
    const before = (await measure(live)).width;
    await wheel(at, { x: 0, y: deltaY }, "Control");
    await soft.poll(async () => (await measure(live)).width).not.toBeCloseTo(before, 1);
    await expect(stage).not.toHaveAttribute("data-moving");

    return (await measure(live)).width / before;
  };

  const soft = expect.configure({ soft: true });

  const presses = () => inGuest(application, url, "String(window.nytePresses ?? 0)");

  await test.step("a page frame loads nothing until it is selected", async () => {
    await expect(showList.or(list)).toBeVisible();

    if (await showList.isVisible()) await showList.click();
    await list.getByRole("button", { name: "Live page", exact: true }).click();
    await expect(stage).not.toHaveAttribute("data-moving");
    await expect(live).toHaveAttribute("data-page-state", "still");
    await expect(computed).toHaveAttribute("data-page-state", "still");
    expect(requests.get("/")).toBeUndefined();
  });

  await test.step("selecting the frame loads its page over the frame", async () => {
    await board.locator('[data-frame="Live page"]').click();
    await expect(live).toHaveAttribute("data-page-state", "live");
    await expect.poll(() => requests.get("/")).toBe(1);
    await expect.poll(aligned).toBe(true);
    await expect
      .poll(async () => paintsPage(await colorAt(desktop, pageBackground(await measure(cover)))))
      .toBe(true);
    await inGuest(
      application,
      url,
      `window.nytePresses = 0; addEventListener("pointerdown", () => { window.nytePresses += 1 }, true)`,
    );
    await capture("design-live-page");
  });

  await test.step("over the live page a wheel pans the board, Control and the wheel zoom it, and a click selects on it", async () => {
    const before = await measure(live);
    await wheel(middle(before), { x: 0, y: 120 });
    await expect.poll(async () => (await measure(live)).y).toBeLessThan(before.y - 60);
    await expect.poll(aligned).toBe(true);

    const ratio = await zoomRatio(middle(await measure(live)), -30);
    testInfo.annotations.push({ type: "zoom over the live page", description: String(ratio) });
    expect(ratio).toBeGreaterThan(1.1);
    await expect.poll(aligned).toBe(true);

    await page.mouse.click(middle(await measure(live)).x, middle(await measure(live)).y);
    await expect(live).toHaveAttribute("data-page-state", "live");
    soft(await presses(), "presses that reached the live page").toBe("0");
  });

  let boardRatio = 0;

  await test.step("a double click enters the page: a click gives it the keys, and a plain wheel scrolls it", async () => {
    boardRatio = await zoomRatio(middle(await measure(live)), -30);
    await page.mouse.dblclick(middle(await measure(live)).x, middle(await measure(live)).y);
    await expect(live).toHaveAttribute("data-page-state", "entered");
    await expect
      .poll(() => shownGuest.evaluate((element) => getComputedStyle(element).pointerEvents))
      .toBe("auto");

    const field = await pagePoint("field");
    await page.mouse.click(field.x, field.y);
    await page.keyboard.type("hello");
    await soft
      .poll(() => inGuest(application, url, 'document.getElementById("field").value'), {
        message: "keys reach the entered page after a click",
      })
      .toBe("hello");
    soft(Number(await presses()), "presses that reached the entered page").toBeGreaterThan(0);

    const before = await measure(live);
    await wheel(middle(before), { x: 0, y: 300 });
    await soft.poll(() => inGuest(application, url, "String(window.scrollY)")).not.toBe("0");
    soft((await measure(live)).y, "the board stays put under a plain wheel").toBeCloseTo(
      before.y,
      0,
    );
  });

  await test.step("Control and the wheel over the entered page zoom the board as fast as over the board, and Command pans it", async () => {
    const ratio = await zoomRatio(middle(await measure(live)), -30);
    testInfo.annotations.push({
      type: "zoom over the entered page",
      description: `${String(ratio)} against ${String(boardRatio)} over the live page`,
    });
    soft(
      Math.log(ratio) / Math.log(boardRatio),
      "zoom speed over the page against the board",
    ).toBeCloseTo(1, 1);
    await expect(live).toHaveAttribute("data-page-state", "entered");

    if (process.platform === "darwin") {
      const scrolled = await inGuest(application, url, "String(window.scrollY)");
      const before = await measure(live);
      await wheel(middle(before), { x: 0, y: 100 }, "Meta");
      await soft.poll(async () => (await measure(live)).y).toBeLessThan(before.y - 10);
      soft(await inGuest(application, url, "String(window.scrollY)")).toBe(scrolled);
    }
  });

  const pageState = async (): Promise<string> => (await live.getAttribute("data-page-state")) ?? "";

  const offFrame = async (): Promise<{ x: number; y: number } | undefined> => {
    const frame = await measure(live);
    const area = await measure(workbench(page).locator('iframe[title="Design board"]'));

    return [
      { x: area.x + 8, y: area.y + 8 },
      { x: area.x + area.width - 8, y: area.y + 8 },
      { x: area.x + 8, y: area.y + area.height - 8 },
      { x: area.x + area.width - 8, y: area.y + area.height - 8 },
    ].find(
      (point) =>
        point.x < frame.x ||
        point.x > frame.x + frame.width ||
        point.y < frame.y ||
        point.y > frame.y + frame.height,
    );
  };

  const pressOffFrame = async (): Promise<void> => {
    const away = await offFrame();

    if (away === undefined) throw new Error("The page frame covers the whole board.");
    await page.mouse.click(away.x, away.y);
  };

  const deselect = async (): Promise<void> => {
    if ((await pageState()) === "entered") {
      await pressOffFrame();
      await expect(live).toHaveAttribute("data-page-state", "live");
    }

    await pressOffFrame();
    await expect(live).toHaveAttribute("data-page-state", "still");
  };

  await test.step("Escape returns the entered page to live, and a press elsewhere on the board leaves it too", async () => {
    await pressInGuest(application, url, "Escape", []);
    await soft(live, "Escape in the entered page returns it to live").toHaveAttribute(
      "data-page-state",
      "live",
    );
    await expect
      .poll(() => shownGuest.evaluate((element) => getComputedStyle(element).pointerEvents))
      .toBe("none");
    await page.mouse.dblclick(middle(await measure(live)).x, middle(await measure(live)).y);
    await expect(live).toHaveAttribute("data-page-state", "entered");
    await pressOffFrame();
    await soft(live, "a press elsewhere on the board leaves the page").toHaveAttribute(
      "data-page-state",
      "live",
    );

    if ((await pageState()) === "entered") await pressOffFrame();
    await expect(live).toHaveAttribute("data-page-state", "live");
  });

  await test.step("zoomed in past 100%, the page is clipped at the board's edge, and the zoom menu draws over it", async () => {
    await zoomRatio(middle(await measure(live)), -100);
    await zoomRatio(middle(await measure(live)), -100);
    soft(Number.parseInt((await zoomButton.textContent()) ?? "0", 10)).toBeGreaterThan(100);
    await expect.poll(aligned).toBe(true);

    const area = await measure(workbench(page).locator('iframe[title="Design board"]'));
    const shown = await guestBox(desktop, url);

    if (shown === null) throw new Error("The live page is not shown.");
    soft(shown.page.width).toBeGreaterThan(area.width);
    soft(shown.box.x).toBeGreaterThanOrEqual(area.x - 1);
    soft(shown.box.y).toBeGreaterThanOrEqual(area.y - 1);
    soft(shown.box.x + shown.box.width).toBeLessThanOrEqual(area.x + area.width + 1);
    soft(shown.box.y + shown.box.height).toBeLessThanOrEqual(area.y + area.height + 1);

    const scale = shown.page.width / 800;
    const inside = { x: shown.page.x + 420 * scale, y: shown.page.y + 270 * scale };
    soft(
      inside.x > area.x && inside.x < area.x + area.width && inside.y > area.y,
      "the sampled point is on the board",
    ).toBe(true);
    soft(paintsPage(await colorAt(desktop, inside)), "the page paints inside the board").toBe(true);
    soft(
      paintsPage(await colorAt(desktop, { x: area.x + area.width / 2, y: area.y - 6 })),
      "the page paints above the board",
    ).toBe(false);
    await capture("design-live-page-clipped");

    await zoomButton.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    const over = overlapMiddle(shown.box, await measure(menu));
    soft(over, "the zoom menu overlaps the page").not.toBeNull();

    if (over !== null) {
      soft(paintsPage(await colorAt(desktop, over)), "the page paints over the zoom menu").toBe(
        false,
      );
    }
    await page.getByRole("menuitem", { name: "Zoom to Fit" }).click();
    await expect(stage).not.toHaveAttribute("data-moving");
    await soft(live).toHaveAttribute("data-page-state", "live");
    await soft.poll(aligned).toBe(true);
  });

  await test.step("deselecting the frame leaves a still of the page in it", async () => {
    await deselect();
    await soft.poll(() => guestBox(desktop, url), { message: "the page parks" }).toBeNull();

    const still = workbench(page).locator('img[src^="data:image/jpeg"]');
    await soft(still, "a still shows in the frame").toBeVisible();

    if (await still.isVisible()) {
      const stillBox = await measure(still);
      const frameBox = await measure(live);
      soft(Math.abs(stillBox.x - frameBox.x)).toBeLessThan(2);
      soft(Math.abs(stillBox.y - frameBox.y)).toBeLessThan(2);
      soft(Math.abs(stillBox.width - frameBox.width)).toBeLessThan(2);
      soft(
        paintsPage(await colorAt(desktop, pageBackground(frameBox))),
        "the still shows the page",
      ).toBe(true);
    }

    await capture("design-live-page-still");
  });

  await test.step("Design Mode from the toolbar takes the selected page at once, picks into the composer, and turns off when the frame is deselected", async () => {
    const chips = page.locator('[data-composer-chip="excerpt"]');
    const picked = await chips.count();
    const xray = workbench(page).getByRole("button", { name: "X-ray", exact: true });

    await list.getByRole("button", { name: "Live page", exact: true }).click();
    await expect(stage).not.toHaveAttribute("data-moving");
    await board.locator('[data-frame="Live page"]').click();
    await expect(live).toHaveAttribute("data-page-state", "live");
    await expect.poll(aligned).toBe(true);
    await expect(designMode).toBeEnabled();

    await designMode.click();
    await expect(designMode).toHaveAttribute("aria-pressed", "true");
    await soft(live, "Design Mode enters the page").toHaveAttribute("data-page-state", "entered");
    await expect(xray).toBeVisible();
    await expect(stage).not.toHaveAttribute("data-moving");
    await expect.poll(aligned).toBe(true);
    await soft
      .poll(
        () =>
          inGuest(
            application,
            url,
            '[...document.documentElement.children].some((element) => getComputedStyle(element).cursor === "crosshair")',
          ),
        { message: "the page shows Design Mode's overlay" },
      )
      .toBe("true");

    const title = await pagePoint("title");
    await page.mouse.move(title.x + 30, title.y + 30);
    await page.mouse.move(title.x, title.y, { steps: 4 });
    await page.mouse.click(title.x, title.y);
    await soft(chips, "a pick from the board's page in the composer").toHaveCount(picked + 1);
    await soft(composer(page), "a pick hands the keyboard to the composer").toBeFocused();
    await capture("design-live-page-design-mode");

    await xray.click();
    await soft(xray, "the X-ray view turns on").toHaveAttribute("aria-pressed", "true");

    await deselect();
    await soft(designMode, "deselecting turns Design Mode off").toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await soft(designMode).toBeDisabled();
  });

  await test.step("a page frame whose address is an expression never loads", async () => {
    await board.locator('[data-frame="Computed page"]').click();
    await expect(computed).toHaveAttribute("data-page-state", "live");
    await expect(live).toHaveAttribute("data-page-state", "still");
    await expect(designMode).toBeDisabled();
    expect(requests.get("/expr")).toBeUndefined();
  });

  await test.step("another workbench tab hides the live page, and coming back shows it again", async () => {
    await board.locator('[data-frame="Live page"]').click();
    await expect(live).toHaveAttribute("data-page-state", "live");
    await expect.poll(aligned).toBe(true);
    await page.getByRole("button", { name: "New workbench tab" }).click();
    await page.getByRole("menuitem", { name: "Editor", exact: true }).click();
    await expect(designTab).toHaveAttribute("aria-selected", "false");
    await expect.poll(() => guestBox(desktop, url)).toBeNull();
    await designTab.click();
    await expect(designTab).toHaveAttribute("aria-selected", "true");
    await expect(live).toHaveAttribute("data-page-state", "live");
    await expect.poll(aligned).toBe(true);
    expect(requests.get("/expr")).toBeUndefined();
  });
});
