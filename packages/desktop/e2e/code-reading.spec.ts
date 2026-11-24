import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { closeWindow, editor, goTo } from "./desk.ts";
import { launchDesktop } from "./launch.ts";
import { openChat } from "./ui.ts";
import { percentile } from "./work-counts.ts";

const DEMO = process.env["NYTE_DEMO"];

const BUN = process.env["NYTE_DEMO_BUN"] ?? "/tmp/bun";

const BUN_REMOTE = "https://github.com/oven-sh/bun.git";

const HOME = process.env["NYTE_DEMO_HOME"] ?? join(tmpdir(), "nyte-demo-bun-home");

const COUNTDOWN_SECONDS = 10;

const SWITCH_ROUNDS = 3;

const TRAIL = ["src", "js_parser", "p.rs"] as const;

const OPENS = [
  "packages/bun-types/bun.d.ts",
  "src/jsc/bindings/BunPlugin.cpp",
  "test/cli/check/check.test.ts",
  "src/runtime/node/node_fs.rs",
  "src/sema/program.rs",
  "test/cli/lint/lint.test.ts",
  "test/cli/install/bun-install.test.ts",
  "test/js/sql/sql.test.ts",
  "src/sys/lib.rs",
] as const;

const LAST_LINE = { path: "test/cli/check/check.test.ts", line: 25_731 } as const;

const run = promisify(execFile);

test.skip(DEMO === undefined, "A demo: set NYTE_DEMO=1 to run it.");

// oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads a test's fixtures from this pattern, and the demo launches its own app
test("the Code window reads Bun", async ({}, testInfo) => {
  test.setTimeout(900_000);
  await using stack = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-demo-")));
  stack.defer(() => rm(parent, { recursive: true, force: true }));
  const home = await bunHome();
  const launched = await launchDesktop({ home, parentDirectory: parent });
  stack.defer(() => launched.close());
  const application = launched.application;
  const problems = [collectErrors(launched.page)];

  await openChat(launched.page, FIXTURES.beta);
  const opening = application.waitForEvent("window");
  await launched.page
    .getByRole("group", { name: "Apps" })
    .getByRole("button", { name: "Code", exact: true })
    .click();
  const code = await opening;
  problems.push(collectErrors(code));
  await code.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
  await closeWindow(application, launched.page);

  await (
    await application.browserWindow(code)
  ).evaluate((window, size) => window.setBounds(size), await filmBounds(application));

  const tree = await showExplorer(code);
  await expect(tree.getByRole("treeitem").first()).toBeVisible({ timeout: 120_000 });
  await code.keyboard.press("Meta+p");

  for (const path of [TRAIL.join("/"), ...OPENS]) {
    await code.getByRole("combobox", { name: "Go to file" }).fill(path);
    await expect(code.getByRole("option").first(), `Quick Open finds ${path}`).toContainText(
      basename(path),
      { timeout: 120_000 },
    );
  }

  await code.keyboard.press("Escape");
  await editor(code).getByRole("button", { name: "Collapse Folders" }).click();
  await expect(tree.getByRole("treeitem", { expanded: true })).toHaveCount(0);
  await code.mouse.move(0, 0);
  await settle(code);

  await countdown(code, COUNTDOWN_SECONDS);

  const frames = await watchFrames(code);
  const opens: number[] = [];
  const switches: number[] = [];

  await test.step("the explorer down to the Rust parser", async () => {
    await hover(code, tree);
    await scroll(code, ramp(20, 400, 25));
    await scroll(
      code,
      Array.from({ length: 25 }, () => -800),
    );

    for (const folder of TRAIL.slice(0, -1)) {
      await bringIntoView(code, tree, treeItem(tree, folder));
      await treeItem(tree, folder).click();
    }

    const file = treeItem(tree, TRAIL.at(-1) ?? "");
    await bringIntoView(code, tree, file);
    const started = performance.now();
    await file.click();
    await drawn(code, TRAIL.join("/"));
    opens.push(performance.now() - started);
  });

  await test.step("a 10,000-line Rust parser flung end to end", async () => {
    await hover(code, source(code, TRAIL.join("/")));
    await scroll(code, ramp(20, 4000, 40));
    await scroll(
      code,
      Array.from({ length: 40 }, () => 4000),
    );
    await scroll(
      code,
      Array.from({ length: 30 }, () => -8000),
    );
  });

  for (const path of OPENS) {
    await test.step(`${path} from Quick Open`, async () => {
      opens.push(await quickOpen(code, path));
      await hover(code, source(code, path));
      await scroll(code, ramp(200, 3000, 25));
    });
  }

  await test.step(`${String(SWITCH_ROUNDS)} rounds over every open file`, async () => {
    const paths = [TRAIL.join("/"), ...OPENS];

    for (let round = 0; round < SWITCH_ROUNDS; round += 1) {
      for (const [index, path] of paths.entries()) {
        switches.push(await switchTo(code, path));
        await hover(code, source(code, path));
        await scroll(
          code,
          Array.from({ length: 8 }, () => ((round + index) % 2 === 0 ? 2500 : -2500)),
        );
      }
    }
  });

  await test.step("the last line of a 25,000-line, 1.5 MB test", async () => {
    await switchTo(code, LAST_LINE.path);
    await goTo(code, LAST_LINE.line, 1);
    await hold(code, 1000);
    await goTo(code, 1, 1);
    await hold(code, 1500);
  });

  const deltas = await frames.stop();

  const report = {
    repository: BUN,
    files: [TRAIL.join("/"), ...OPENS].length,
    openMs: summary(opens),
    switchMs: summary(switches),
    frameMs: { ...summary(deltas), over33: deltas.filter((delta) => delta > 33.4).length },
  };

  process.stdout.write(`code-reading: ${JSON.stringify(report)}\n`);
  await testInfo.attach("film", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  for (const found of problems) {
    expect(found.pageErrors, "uncaught page errors").toEqual([]);
    expect(
      found.consoleErrors.filter((text) => !text.startsWith("DEV:")),
      "console errors",
    ).toEqual([]);
  }
});

async function bunHome(): Promise<string> {
  const home = join(HOME, "home");
  const seed = join(HOME, "seed");

  if (!(await exists(join(HOME, "ready"))) || !(await exists(seed))) await prepareBunHome(seed);

  await rm(join(home, ".nyte"), { recursive: true, force: true });
  await rm(join(home, "Library"), { recursive: true, force: true });
  await copy(seed, join(home, ".nyte"));

  return realpath(home);
}

async function prepareBunHome(seed: string): Promise<void> {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
  const home = (await prepareHome(await realpath(HOME))).home;

  await copy(join(home, ".nyte"), seed);

  if (!(await exists(join(BUN, ".git")))) {
    await run("git", ["clone", "--depth", "1", BUN_REMOTE, BUN], { timeout: 600_000 });
  }

  await copy(`${BUN}/.`, home);
  await writeFile(join(HOME, "ready"), "");
}

async function copy(source: string, target: string): Promise<void> {
  await (process.platform === "darwin"
    ? run("/bin/cp", ["-cR", source, target])
    : run("cp", ["-R", source, target]));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function filmBounds(application: ElectronApplication) {
  return application.evaluate((electron) => {
    const area = electron.screen.getPrimaryDisplay().workArea;
    const width = Math.min(1600, area.width - 80);
    const height = Math.min(1000, area.height - 80);

    return {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };
  });
}

async function countdown(page: Page, seconds: number): Promise<void> {
  await page.evaluate(() => {
    const badge = document.createElement("div");

    badge.id = "nyte-demo-countdown";
    badge.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;pointer-events:none;font:600 120px/1 system-ui;color:#fff;background:rgb(0 0 0 / 0.6)";
    document.body.append(badge);
  });

  for (let left = seconds; left > 0; left -= 1) {
    await page.evaluate((text) => {
      const badge = document.querySelector("#nyte-demo-countdown");

      if (badge !== null) badge.textContent = text;
    }, String(left));
    process.stdout.write(`demo starts in ${String(left)}\n`);
    await hold(page, 1000);
  }

  await page.evaluate(() => document.querySelector("#nyte-demo-countdown")?.remove());
  await settle(page);
}

async function showExplorer(page: Page): Promise<Locator> {
  const files = editor(page);
  const toggle = files.getByRole("button", { name: "Editor Sidebar", pressed: false });

  await expect(toggle.or(files.getByRole("tree").first())).toBeVisible();

  if (await toggle.isVisible()) await toggle.click();

  return files.getByRole("tree").first();
}

function treeItem(tree: Locator, name: string): Locator {
  return tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}\\b`, "u") }).first();
}

function source(page: Page, path: string): Locator {
  return editor(page).getByRole("textbox", { name: path, exact: true });
}

async function drawn(page: Page, path: string): Promise<void> {
  await expect(source(page, path).locator("[data-line]").first()).toBeVisible();
}

async function quickOpen(page: Page, path: string): Promise<number> {
  await editor(page).getByRole("tab", { selected: true }).click();
  await page.keyboard.press("Meta+p");
  const field = page.getByRole("combobox", { name: "Go to file" });

  await field.pressSequentially(path, { delay: 6 });
  await expect(page.getByRole("option").first()).toContainText(basename(path));
  const started = performance.now();
  await field.press("Enter");
  await drawn(page, path);

  return performance.now() - started;
}

async function switchTo(page: Page, path: string): Promise<number> {
  const started = performance.now();

  const tab = editor(page).getByRole("tab", { name: new RegExp(`^${escape(path)}`, "u") });

  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: path, exact: true }).click();
  }

  await drawn(page, path);

  return performance.now() - started;
}

async function bringIntoView(page: Page, tree: Locator, item: Locator): Promise<void> {
  await hover(page, tree);

  for (let step = 0; step < 200 && !(await inside(tree, item)); step += 1) await scroll(page, [90]);

  expect(await inside(tree, item), `${String(item)} never scrolled into the explorer`).toBe(true);
}

async function inside(tree: Locator, item: Locator): Promise<boolean> {
  if (!(await item.isVisible())) return false;
  const area = await tree.boundingBox();
  const row = await item.boundingBox();

  return (
    area !== null &&
    row !== null &&
    row.y >= area.y &&
    row.y + row.height <= area.y + area.height - 24
  );
}

async function hover(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();

  if (box === null) throw new Error(`${String(target)} has no box to hover.`);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400), { steps: 4 });
}

async function scroll(page: Page, deltas: readonly number[]): Promise<void> {
  for (const delta of deltas) {
    await page.mouse.wheel(0, delta);
    await nextFrame(page);
  }
}

function ramp(from: number, to: number, steps: number): number[] {
  const ratio = (Math.abs(to) / Math.abs(from)) ** (1 / (steps - 1));

  return Array.from({ length: steps }, (_, index) => Math.round(from * ratio ** index));
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
}

async function settle(page: Page): Promise<void> {
  for (let frame = 0; frame < 30; frame += 1) await nextFrame(page);
}

async function hold(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function watchFrames(page: Page): Promise<{ stop(): Promise<number[]> }> {
  const watching = await page.evaluateHandle(() => {
    const times: number[] = [];
    const state = { times, running: true };

    const tick = (time: number): void => {
      state.times.push(time);

      if (state.running) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    return state;
  });

  return {
    stop: async () => {
      const times = await watching.evaluate((state) => {
        state.running = false;

        return state.times;
      });

      return times.slice(1).map((time, index) => time - (times[index] ?? time));
    },
  };
}

function summary(values: readonly number[]) {
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(0, ...values)),
    count: values.length,
  };
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
