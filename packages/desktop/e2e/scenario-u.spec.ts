import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import {
  HOURS_ANSWER,
  HOURS_COMMAND,
  HOURS_DONE,
  HOURS_QUESTION,
  prepareScenarioU,
} from "@nyte-ai/app/e2e/scenario-u-fixture";
import {
  expectWithinBudgets,
  readRendererSpans,
  recordRun,
  settledFrames,
  submitTrace,
  tabTo,
} from "@nyte-ai/app/e2e/scenario-u-trace";
import { readPrintedSpans, readSpanFile, RESTAURANT_PROMPT } from "@nyte-ai/host/bench";
import { prepareHome } from "./baseline.ts";
import { launchDesktop } from "./launch.ts";
import { composer, messages } from "./ui.ts";

/** The transcript row a quit mid-answer leaves settled: the step group holding the command. */
const LAST_SETTLED = /button "Ran 1 command, 2 tools"/u;

const MEASURING = process.env.NYTE_SCENARIO_U_MEASURE === "1";

function workbench(page: Page) {
  return page.getByRole("complementary", { name: "Workbench" });
}

/** The scrollback the workbench saved for its terminal tabs, as the next launch restores it. */
function savedScrollback(page: Page): Promise<string> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("nyte.terminal."))
      .map((key) => localStorage.getItem(key) ?? "")
      .join("\n"),
  );
}

test("scenario U: a random restaurant nearby, quit mid-answer, reopen and resume", async () => {
  test.setTimeout(240_000);
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-scenario-u-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const { home } = await prepareHome(parent);
  const scenario = await prepareScenarioU(home);
  cleanup.defer(() => scenario.close());
  const appData = join(parent, "app-data");
  await mkdir(appData);
  const environment = { NYTE_TRACE: "stdout", NYTE_E2E_PLACES_ORIGIN: scenario.origin };
  const first = await launchDesktop({ home, parentDirectory: parent, appData, environment });
  cleanup.defer(() => first.close());
  const { page } = first;

  const shot = (name: string, target: Page) =>
    target.screenshot({ path: test.info().outputPath(`${name}.png`) });

  await test.step("the renderer records spans from its next load", async () => {
    await page.evaluate(() => localStorage.setItem("NYTE_TRACE", "1"));
    await page.reload();
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });
  });

  const errors = collectErrors(page);

  const canvas = messages(page)
    .getByRole("figure", { name: "Random pick nearby" })
    .frameLocator("iframe");

  const question = page.getByRole("form", { name: HOURS_QUESTION });
  let submitted = 0;
  let quitAt = 0;

  await test.step("typing the prompt and Enter submits it", async () => {
    await tabTo(composer(page));
    await page.keyboard.type(RESTAURANT_PROMPT);
    await expect(composer(page)).toHaveText(RESTAURANT_PROMPT);
    submitted = Date.now();
    await page.keyboard.press("Enter");
    await expect(messages(page).getByText(RESTAURANT_PROMPT, { exact: true })).toBeVisible();
  });

  await test.step("the skill loads, the cold places server answers, the canvas paints", async () => {
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(
      messages(page).getByRole("button", { name: "Explored SKILL.md, ran 1 tool" }),
    ).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Luigi's Trattoria" })).toBeVisible();
  });

  await test.step("the canvas link opens the restaurant in the workbench browser", async () => {
    await tabTo(canvas.getByRole("link", { name: "Open menu" }), true);
    await page.keyboard.press("Enter");
    const browser = workbench(page).getByRole("region", { name: "Browser", exact: true });
    await expect(browser.getByRole("combobox", { name: "Address" })).toHaveValue(
      `${scenario.origin}/places/luigi`,
    );
    await expect.poll(() => scenario.visits).toContain("/places/luigi");
  });

  await test.step("the user approves the command from the keyboard", async () => {
    await tabTo(question.getByRole("radiogroup"));
    await page.keyboard.press("1");
    await expect(question.getByRole("radio", { name: /^Run it/u })).toBeChecked();
    await page.keyboard.press("Meta+Enter");
    await expect(question).toBeHidden();
  });

  await test.step("the user runs the same command in a terminal of their own", async () => {
    await page.keyboard.press("Control+`");
    const input = workbench(page).getByRole("textbox", { name: "Terminal input" });
    await expect(input).toBeFocused();
    await page.keyboard.type(`${HOURS_COMMAND}\r`);
    await expect.poll(() => savedScrollback(page), { timeout: 15_000 }).toContain(HOURS_DONE);
  });

  let before = "";

  await test.step("the command's output reaches the model, which starts its answer", async () => {
    await expect(messages(page).getByText(/^I picked/u)).toBeVisible({ timeout: 20_000 });
    const read = first.output.join("");
    expect(read).toMatch(/NYTE_E2E_U \{"tool":"mcp__places__search_places","text":"[^\n]*luigi/u);
    expect(read).toMatch(/NYTE_E2E_U \{"tool":"bash","text":"[^\n]*until 22:30/u);
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
    before = await messages(page).ariaSnapshot();
    await shot("transcript-before-quit", page);
  });

  const rendererBefore = await readRendererSpans(page);
  const trace = submitTrace(rendererBefore);
  const hostBefore = readPrintedSpans(first.output.join(""));

  await test.step("quitting mid-answer stops the app", async () => {
    await expect(messages(page).getByText(HOURS_ANSWER)).toHaveCount(0);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
    quitAt = Date.now();
    await first.close();
  });

  const second = await launchDesktop({ home, parentDirectory: parent, appData, environment });
  cleanup.defer(() => second.close());
  const reopened = second.page;
  const reopenedErrors = collectErrors(reopened);

  await test.step("the reopened chat renders the same settled frames", async () => {
    await expect(
      messages(reopened).getByRole("button", { name: "Ran 1 command, 2 tools" }),
    ).toBeVisible({ timeout: 30_000 });
    const after = await messages(reopened).ariaSnapshot();
    await shot("transcript-after-reopen", reopened);
    await writeFile(test.info().outputPath("transcript-before-quit.yml"), before);
    await writeFile(test.info().outputPath("transcript-after-reopen.yml"), after);
    expect(settledFrames(after, LAST_SETTLED)).toBe(settledFrames(before, LAST_SETTLED));
  });

  await test.step("the canvas, browser tab, terminal and places result come back", async () => {
    const restored = messages(reopened)
      .getByRole("figure", { name: "Random pick nearby" })
      .frameLocator("iframe");
    await expect(restored.getByRole("heading", { name: "Luigi's Trattoria" })).toBeVisible();
    const tabs = reopened.getByRole("tablist", { name: "Workbench tabs" });
    await expect(tabs.getByRole("tab")).toHaveText(["Browser", /./u]);
    await expect(
      workbench(reopened).getByRole("textbox", { name: "Terminal input" }),
    ).toBeVisible();
    expect(await savedScrollback(reopened)).toContain(HOURS_DONE);
    await shot("terminal-after-reopen", reopened);
    await reopened.keyboard.press("Control+`");
    await tabTo(
      workbench(reopened)
        .getByRole("navigation", { name: "Workbench navigation" })
        .getByRole("button", { name: "Browser", exact: true })
        .first(),
      true,
    );
    await reopened.keyboard.press("Enter");
    const browser = workbench(reopened).getByRole("region", { name: "Browser", exact: true });
    await expect(browser.getByRole("combobox", { name: "Address" })).toHaveValue(
      `${scenario.origin}/places/luigi`,
    );
    await writeFile(
      test.info().outputPath("workbench-after-reopen.yml"),
      await workbench(reopened).ariaSnapshot(),
    );
    await tabTo(messages(reopened).getByRole("button", { name: "Explored SKILL.md, ran 1 tool" }));
    await reopened.keyboard.press("Enter");
    const places = messages(reopened).getByRole("button", { name: "places: Search places" });
    await tabTo(places);
    await reopened.keyboard.press("Enter");
    await expect(places.locator("xpath=following::*[@aria-label='Tool output'][1]")).toContainText(
      "Luigi's Trattoria",
    );
    await writeFile(
      test.info().outputPath("places-after-reopen.yml"),
      await messages(reopened).ariaSnapshot(),
    );
  });

  await test.step("the resumed turn finishes the answer", async () => {
    await expect(messages(reopened).getByText(/It is open until 22:30 tonight/u)).toBeVisible({
      timeout: 30_000,
    });
    await shot("transcript-resumed", reopened);
  });

  await test.step("each hop of the submit stays within its budget", async () => {
    const run = await recordRun({
      surface: "desktop",
      trace,
      wallMs: quitAt - submitted,
      sources: [
        { process: "renderer", spans: rendererBefore },
        { process: "host", spans: hostBefore },
        { process: "mcp:places", spans: await readSpanFile(scenario.traceFile) },
      ],
      facts: {
        resumed: readPrintedSpans(second.output.join("")).filter(
          (span) => span.name === "turn.start",
        ),
      },
    });

    if (!MEASURING) expectWithinBudgets(run.waterfall, "desktop");
  });

  expect(reopenedErrors).toEqual({ pageErrors: [], consoleErrors: [] });
});
