import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { buildSourceIndex, compileExpr } from "./grid/cause.ts";
import type { SourceIndex } from "./grid/cause.ts";
import { check } from "./grid/check.ts";
import { clearOverlay, collect, drawOverlay } from "./grid/collect.ts";
import type { Plan, Snapshot } from "./grid/collect.ts";
import { overlayMarks, stateResult, writeReport } from "./grid/report.ts";
import type { StateResult } from "./grid/report.ts";
import { ALIGNMENTS, GRID_RULES, REGIONS, TRANSCRIPT_END } from "./grid/rules.ts";
import {
  chatPane,
  composer,
  leaveSettings,
  messages,
  openNewChat,
  openSettings,
  revealChat,
  setTheme,
  settingsNav,
  sidebar,
} from "./ui.ts";

test.use({ chapter: "grid" });

const OUT = process.env.NYTE_GRID_OUT;

const PROJECT = "Bug Fix and Polish";

/** The parent wakes once or twice for the two agents' reports, so a long reply pushes that part above the fold. */
const ABOVE_THE_FOLD = "/long 12";

const PROMPT = [
  "Here is the **plan** for the sidebar fix: keep `sidebar-row` on the shared inset and check the tab title lines up with it.",
  "",
  "| Region | Inset | Token |",
  "| --- | --- | --- |",
  "| Sidebar | 8px | `sidebar.gutter` |",
  "| Composer | 0px | `conversation.composerInset` |",
];

/** A markdown file for the workbench editor: inline code, inline raw HTML and a table. */
const EDITOR_FILE = [
  "# Editor",
  "",
  "Press <kbd>Enter</kbd> to send, or use `inline code` in a line.",
  "",
  "| Region | Inset | Token |",
  "| --- | --- | --- |",
  "| Sidebar | 8px | `sidebar.gutter` |",
  "| Composer | 0px | `conversation.composerInset` |",
  "",
  "A closing paragraph.",
  "",
].join("\n");

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The main window size: the first of these that fits the display's work area. */
const STANDARD_SIZES: readonly Size[] = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
];

const NARROW_WIDTH = 900;

/** Earlier than any chat the fixture or the journey can create, so every relative time reads "now". */
const HELD_CLOCK = new Date("2020-01-01T00:00:00Z");

/** How many times a state is collected before its geometry is called unstable. */
const STABLE_TRIES = 5;

const panes = (page: Page): Locator => page.getByRole("region", { name: /^(Active )?chat pane$/u });

const workbench = (page: Page): Locator => page.getByRole("complementary", { name: "Workbench" });

test.skip(
  OUT === undefined || OUT === "",
  "Runs only with NYTE_GRID_OUT, the folder the report goes to.",
);

function planFor(index: SourceIndex): Plan {
  return {
    regions: REGIONS.map((region) => ({
      name: region.name,
      locate: region.locate,
      rails: region.rails.map((rail) => ({
        name: rail.name,
        from: rail.from,
        css: compileExpr(index, rail.offset),
      })),
      rows: region.rhythm?.rows ?? null,
      pitch: region.rhythm === null ? null : compileExpr(index, region.rhythm.pitch),
      centred: region.centred,
    })),
    exceptions: Object.values(GRID_RULES).flatMap((rule) =>
      rule.exceptions.flatMap((exception) =>
        exception.match.by === "selector"
          ? [{ name: exception.name, selector: exception.match.selector }]
          : [],
      ),
    ),
    picks: ALIGNMENTS.flatMap((alignment) => [alignment.a, alignment.b]).flatMap((pick) =>
      pick.kind === "box"
        ? [
            {
              name: pick.selector,
              selector: pick.selector,
              bottomEdgePane: pick.within === "bottom-edge-pane",
            },
          ]
        : [],
    ),
    ends: TRANSCRIPT_END,
  };
}

/**
 * The real window's size, never an emulated viewport: emulating past the work area lays the page
 * out at a size the window can't show, so dialogs measure centred in a viewport nobody sees.
 */
async function windowSize(
  application: ElectronApplication,
): Promise<{ main: Size; narrow: Size; workArea: Size }> {
  const workArea = await application.evaluate(
    ({ screen }) => screen.getPrimaryDisplay().workAreaSize,
  );

  const main = STANDARD_SIZES.find(
    (size) => size.width <= workArea.width && size.height <= workArea.height,
  );

  if (main === undefined)
    throw new Error(
      `The display's work area, ${String(workArea.width)}×${String(workArea.height)}, fits none of the grid's window sizes.`,
    );

  return { main, narrow: { width: NARROW_WIDTH, height: main.height }, workArea };
}

/**
 * The window opens on the user's screen and a run once took their keystrokes, so it shows without
 * focus and can't take it; Playwright's input reaches the page over CDP either way.
 */
async function keepUnfocused(application: ElectronApplication): Promise<void> {
  const state = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];

    if (window === undefined) throw new Error("The desktop has no window to keep unfocused.");
    window.setFocusable(false);
    window.hide();
    app.hide();
    window.showInactive();

    return { visible: window.isVisible(), focused: window.isFocused() };
  });

  expect(state, "the grid window is shown without focus").toEqual({
    visible: true,
    focused: false,
  });
}

async function resize(
  desktop: { readonly application: ElectronApplication; readonly page: Page },
  size: Size,
): Promise<void> {
  await desktop.application.evaluate(({ BrowserWindow, screen }, target) => {
    const window = BrowserWindow.getAllWindows()[0];

    if (window === undefined) throw new Error("The desktop has no window to size.");
    const area = screen.getPrimaryDisplay().workArea;
    window.setContentBounds({ x: area.x, y: area.y, width: target.width, height: target.height });
  }, size);

  await expect
    .poll(() => desktop.page.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
}

/** Pointer parked bottom right, away from the sidebar's reveal edge, on nothing a hover would change. */
async function settle(page: Page): Promise<void> {
  const park = await page.evaluate(() => ({ x: innerWidth - 2, y: innerHeight - 2 }));
  await page.mouse.move(park.x, park.y);

  const under = await page.evaluate(({ x, y }) => {
    const found = document
      .elementFromPoint(x, y)
      ?.closest(
        "a, button, input, select, textarea, [role=button], [role=tab], [role=menuitem], [data-slot=row]",
      );

    return found === null || found === undefined ? null : found.outerHTML.slice(0, 160);
  }, park);

  expect(under, "the parked pointer rests on a control").toBeNull();

  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === "running" &&
                animation.timeline instanceof DocumentTimeline &&
                animation.effect?.getComputedTiming().endTime !== Infinity,
            )
            .map((animation) =>
              animation instanceof CSSAnimation
                ? animation.animationName
                : animation.constructor.name,
            ),
        ),
      { message: "finite animations still running", timeout: 10_000 },
    )
    .toEqual([]);
}

/**
 * Relative times ("2m", "1m ago") grow with the e2e seed cache's age, so the renderer's clock is held at
 * a moment before any chat existed: every age clamps to "now". Timers keep running. The page reloads so
 * the minute clock the sidebar reads starts from the held time.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(HELD_CLOCK);
  await page.reload();
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
  expect(await page.evaluate(() => Date.now()), "the renderer's clock is held").toBe(
    HELD_CLOCK.getTime(),
  );
}

/** Types one line into the composer the way a person does and sends it. */
async function type(page: Page, text: string): Promise<void> {
  const field = composer(page);
  await field.click();
  await page.keyboard.insertText(text);
  await expect(field).toHaveText(text);
  await page.keyboard.press("Enter");
  await expect(field).toHaveText("");
  await expect(messages(page).getByText(text, { exact: true }).first()).toBeVisible();
}

/** Waits until no reply is streaming and the transcript has stayed the same for two seconds. */
async function quiet(page: Page): Promise<void> {
  const read = (): Promise<string> =>
    page.evaluate(
      () =>
        `${String(document.querySelectorAll('[aria-label="Stop response"]').length)}|${document.querySelector('[role="region"][aria-label="Messages"]')?.textContent?.length ?? 0}`,
    );

  const seen: string[] = [];

  await expect
    .poll(
      async () => {
        const now = await read();
        seen.push(now);

        return (
          now.startsWith("0|") && seen.slice(-3).every((entry) => entry === now) && seen.length >= 3
        );
      },
      { message: "the chat kept streaming", intervals: [1_000], timeout: 30_000 },
    )
    .toBe(true);
}

async function stableSnapshot(page: Page, plan: Plan, state: string): Promise<Snapshot> {
  let previous = "";

  for (let attempt = 0; attempt < STABLE_TRIES; attempt += 1) {
    await settle(page);
    const snapshot = await page.evaluate(collect, plan);
    const hash = createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");

    if (hash === previous) return snapshot;
    previous = hash;
    await page.waitForTimeout(200);
  }

  throw new Error(`The ${state} state's layout changed between ${String(STABLE_TRIES)} collects.`);
}

test("the rendered layout against the spatial grid", async ({ desktop }) => {
  test.setTimeout(600_000);
  const out = resolve(OUT ?? "");
  const { page } = desktop;
  const index = await buildSourceIndex();
  const plan = planFor(index);
  const results: StateResult[] = [];
  await mkdir(out, { recursive: true });
  await freezeClock(page);
  await keepUnfocused(desktop.application);
  const sizes = await windowSize(desktop.application);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await resize(desktop, sizes.main);
  await setTheme(desktop, "dark");

  const located = new Set<string>();

  const capture = async (state: string): Promise<void> => {
    const snapshot = await stableSnapshot(page, plan, state);
    const checked = check(snapshot);
    const result = stateResult({ state, snapshot, checked, index });
    await writeFile(join(out, `${state}.snapshot.json`), `${JSON.stringify(snapshot)}\n`);
    await page.screenshot({ path: join(out, `${state}-plain.png`) });
    await page.evaluate(drawOverlay, overlayMarks(result));
    await page.screenshot({ path: join(out, `${state}.png`) });
    await page.evaluate(clearOverlay);
    results.push(result);

    for (const region of snapshot.regions) located.add(region.name);
  };

  await test.step("a project chat with agents, a markdown reply and the workbench rail", async () => {
    const environment = {
      ...process.env,
      HOME: desktop.home,
      GIT_AUTHOR_NAME: "E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.test",
      GIT_COMMITTER_NAME: "E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.test",
    };

    const git = (...args: string[]): Buffer =>
      execFileSync("git", args, { cwd: desktop.home, env: environment });

    git("init", "-q", "-b", "main");
    await writeFile(join(desktop.home, "README.md"), "# Home\n");
    await writeFile(join(desktop.home, "editor.md"), EDITOR_FILE);
    git("add", "README.md", "editor.md");
    git("commit", "-q", "-m", "init");
    await writeFile(join(desktop.home, "README.md"), "# Home\n\nEdited.\n");
    await sidebar(page).getByRole("button", { name: "New Project" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(PROJECT);
    await page.getByRole("button", { name: "Create Project" }).click();
    const field = composer(page);
    await expect(field).toBeVisible();
    await type(page, "/agents");
    const log = messages(page);
    await expect(log.getByText("2 agents done")).toBeVisible({ timeout: 30_000 });
    await expect(log.getByText("Done", { exact: true })).toHaveCount(4);
    await expect(log.getByRole("paragraph").last()).toHaveText("An agent reported back.");
    await quiet(page);
    await type(page, ABOVE_THE_FOLD);
    await expect(log.getByText(/^Paragraph 12 of 12/u)).toBeVisible({ timeout: 30_000 });
    await quiet(page);
    await field.click();

    for (const [position, line] of PROMPT.entries()) {
      if (position > 0) await page.keyboard.press("Shift+Enter");

      if (line !== "") await page.keyboard.insertText(line);
    }

    await page.keyboard.press("Enter");
    await expect(messages(page).getByRole("table")).toBeVisible({ timeout: 30_000 });
    await expect(messages(page).getByRole("strong").first()).toHaveText("plan");
    await page.getByRole("button", { name: "Open workbench panel" }).click();
    await page.getByRole("button", { name: "New workbench tab" }).click();
    await page
      .getByRole("menu", { name: "New workbench tab" })
      .getByRole("menuitem", { name: "Files" })
      .click();

    await expect(
      page.getByRole("tablist", { name: "Workbench tabs" }).getByRole("tab", { name: "Files" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Close workbench panel" }).click();
    await expect(workbench(page)).toContainText("Open Tabs");
    await expect(
      workbench(page).getByRole("button", { name: `${PROJECT} Settings` }),
    ).toBeVisible();
  });

  await test.step("main, dark and light", async () => {
    await capture("main-dark");
    await setTheme(desktop, "light");
    await capture("main-light");
    await setTheme(desktop, "dark");
  });

  await test.step("workbench closed", async () => {
    await page.getByRole("button", { name: "Collapse workbench" }).click();
    await expect(page.getByRole("button", { name: "Expand workbench" })).toBeVisible();
    await capture("workbench-closed");
    await page.getByRole("button", { name: "Expand workbench" }).click();
    await expect(page.getByRole("button", { name: "Collapse workbench" })).toBeVisible();
  });

  await test.step("sidebar collapsed", async () => {
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(sidebar(page)).toBeHidden();
    await capture("sidebar-collapsed");
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(sidebar(page)).toBeVisible();
  });

  await test.step("narrow window", async () => {
    await resize(desktop, sizes.narrow);
    await capture("narrow");
    await resize(desktop, sizes.main);
  });

  await test.step("blank new chat", async () => {
    await openNewChat(page);
    await capture("new-chat");
  });

  await test.step("the project's lead chat and its settings", async () => {
    await sidebar(page)
      .getByRole("button", { name: new RegExp(`^${PROJECT}`, "u") })
      .first()
      .click();

    await expect(messages(page).getByRole("table")).toBeVisible();
    const settings = workbench(page).getByRole("button", { name: `${PROJECT} Settings` });
    await expect(settings).toBeVisible();
    await capture("project");
    await settings.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture("project-dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  await test.step("split of two chats", async () => {
    const box = await chatPane(page).boundingBox();
    const row = await (await revealChat(page, FIXTURES.markdown)).boundingBox();

    if (box === null || row === null) throw new Error("The chat pane or the chat row has no box.");
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(panes(page)).toHaveCount(2);
    await capture("split");
  });

  await test.step("split down: the same two chats stacked, captured without scrolling", async () => {
    const top = await panes(page).nth(0).boundingBox();
    const row = await (await revealChat(page, FIXTURES.markdown)).boundingBox();

    if (top === null || row === null) throw new Error("The chat pane or the chat row has no box.");
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(top.x + top.width / 2, top.y + top.height - 12, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole("separator", { name: "Resize chat panes" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await expect(panes(page)).toHaveCount(2);
    await expect(
      panes(page).nth(0).getByRole("region", { name: "Messages", exact: true }),
    ).toContainText("Echo: Here is the plan");
    await capture("split-down");
  });

  await test.step("settings: General and Appearance, the page with the most rows", async () => {
    await openSettings(page, "General");
    await capture("settings-general");
    await openSettings(page, "Appearance");
    await capture("settings-appearance");
    await expect(settingsNav(page)).toBeVisible();
  });

  await test.step("the workbench markdown editor on a committed file, beside one chat, with the test home's .nyte folder collapsed so its runtime files stay out of the tree", async () => {
    await leaveSettings(page);
    await panes(page).nth(1).getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Close Pane" }).click();
    await expect(panes(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Open workbench panel" }).click();
    await page
      .getByRole("tablist", { name: "Workbench tabs" })
      .getByRole("tab", { name: "Files" })
      .click();
    const files = workbench(page).getByRole("region", { name: "Files" });
    await files.getByRole("button", { name: "Show Explorer" }).click();
    await files.getByRole("treeitem", { name: /editor\.md/u }).click();
    const editor = files.getByRole("textbox", { name: "editor.md" });
    await expect(editor.getByRole("heading", { name: "Editor", level: 1 })).toBeVisible();
    await expect(editor.getByRole("table")).toBeVisible();
    await files.getByRole("treeitem", { name: /^\.nyte/u }).click();
    await expect(files.getByRole("treeitem")).toHaveCount(4);
    await capture("workbench-editor");
  });

  await test.step("the workbench Changes and Browser tabs, for their toolbars, with the test home's runtime files excluded from git; it stays the last step, since a state after it would see a different git status", async () => {
    const open = async (kind: string): Promise<Locator> => {
      await page.getByRole("button", { name: "New workbench tab" }).click();
      await page
        .getByRole("menu", { name: "New workbench tab" })
        .getByRole("menuitem", { name: kind })
        .click();

      return workbench(page).getByRole("tabpanel", { name: kind });
    };

    await writeFile(join(desktop.home, ".git", "info", "exclude"), ".nyte/\nLibrary/\n");
    await writeFile(join(desktop.home, "README.md"), "# Home\n\nEdited.\n");
    const changes = (await open("Changes")).getByRole("region", { name: "Workspace changes" });
    await expect(changes.getByText("README.md").first()).toBeVisible();
    await expect(changes.getByText(".nyte", { exact: false })).toHaveCount(0, { timeout: 15_000 });
    await expect(changes.getByText("Library", { exact: false })).toHaveCount(0);
    await capture("workbench-changes");
    const browser = (await open("Browser")).getByRole("region", { name: "Browser" });
    await expect(browser.getByText("Type an address or a search")).toBeVisible();
    await capture("workbench-browser");
  });

  const missing = REGIONS.map((region) => region.name).filter((name) => !located.has(name));

  expect(missing, "declared regions that no state matched: a stale locator").toEqual([]);

  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

  const changed = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "").length;

  const summary = await writeReport({
    out,
    build: { head, changedFiles: changed },
    window: { ...sizes, scale: await page.evaluate(() => devicePixelRatio) },
    states: results,
  });

  process.stdout.write(summary);
});
