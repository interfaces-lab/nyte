import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { readSpanFile, RESTAURANT_PROMPT } from "@nyte-ai/host/bench";
import { clearSpans, enableTracing, readSpans } from "@nyte-ai/sdk";
import { collectErrors } from "../utils/errors.ts";
import {
  HOURS_ANSWER,
  HOURS_COMMAND,
  HOURS_DONE,
  HOURS_QUESTION,
  prepareScenarioU,
} from "./scenario-u-fixture.ts";
import { openScenarioHost } from "./scenario-u-host.ts";
import type { ScenarioHost } from "./scenario-u-host.ts";
import {
  expectWithinBudgets,
  readRendererSpans,
  recordRun,
  settledFrames,
  submitTrace,
  tabTo,
} from "./scenario-u-trace.ts";

/** The transcript row a quit mid-answer leaves settled: the step group holding the command. */
const LAST_SETTLED = /button "Ran 1 command, 2 tools"/u;

const MEASURING = process.env.NYTE_SCENARIO_U_MEASURE === "1";

const TOKEN = "nyte-scenario-u-token-0123456789abcdef";

function messages(page: Page) {
  return page.getByRole("region", { name: "Messages" });
}

function workbench(page: Page) {
  return page.getByRole("complementary", { name: "Workbench" });
}

/** A port nothing listens on, kept for both of the host's runs so the paired browser finds it again. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (address === null || typeof address === "string") throw new Error("No free port.");

  return address.port;
}

/** The scrollback the workbench saved for its terminal tabs, as the next load restores it. */
function savedScrollback(page: Page): Promise<string> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("nyte.terminal."))
      .map((key) => localStorage.getItem(key) ?? "")
      .join("\n"),
  );
}

/** A browser context that records renderer spans, from `storage` when the browser reopens. */
async function openContext(
  browser: Browser,
  storage?: Awaited<ReturnType<BrowserContext["storageState"]>>,
) {
  const context = await browser.newContext({ storageState: storage });
  await context.addInitScript(() => {
    if (window === window.top) localStorage.setItem("NYTE_TRACE", "1");
  });

  return context;
}

test("scenario U on the web: a random restaurant nearby, quit mid-answer, reopen and resume", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  enableTracing();
  clearSpans();
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-web-scenario-u-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  await mkdir(home);
  const scenario = await prepareScenarioU(home);
  cleanup.defer(() => scenario.close());
  const port = await freePort();
  const database = join(parent, "nyte.db");

  const open = async (): Promise<ScenarioHost> => {
    const host = await openScenarioHost({
      database,
      home,
      port,
      token: TOKEN,
      places: scenario.origin,
    });

    cleanup.defer(() => host.close().catch(() => undefined));

    return host;
  };

  const host = await open();
  const context = await openContext(browser);
  cleanup.defer(() => context.close());
  const page = await context.newPage();
  const errors = collectErrors(page);

  const shot = (name: string, target: Page) =>
    target.screenshot({ path: test.info().outputPath(`${name}.png`) });

  const composer = page.getByRole("combobox", { name: "Message" });
  const question = page.getByRole("form", { name: HOURS_QUESTION });

  const canvas = messages(page)
    .getByRole("figure", { name: "Random pick nearby" })
    .frameLocator("iframe");

  await page.goto(host.pairing);
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
  let submitted = 0;
  let quitAt = 0;

  await test.step("typing the prompt and Enter submits it", async () => {
    await tabTo(composer);
    await page.keyboard.type(RESTAURANT_PROMPT);
    await expect(composer).toHaveText(RESTAURANT_PROMPT);
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

  await test.step("the canvas link asks first, then opens the menu in a new browser tab", async () => {
    const asked = page.waitForEvent("dialog");
    const opened = context.waitForEvent("page");
    await tabTo(canvas.getByRole("link", { name: "Open menu" }), true);
    await page.keyboard.press("Enter");
    const dialog = await asked;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toBe(`Open external website?\n\n${scenario.origin}/places/luigi`);
    await dialog.accept();
    const menu = await opened;
    await expect(menu).toHaveURL(`${scenario.origin}/places/luigi`);
    await expect(menu).toHaveTitle("Menu: luigi");
    await menu.close();
    await expect(workbench(page).getByRole("tablist", { name: "Workbench tabs" })).toHaveCount(0);
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
    const results = host.fake.requests.flatMap((request) =>
      request.context.messages.flatMap((message) =>
        message.role === "toolResult" ? [message] : [],
      ),
    );

    const read = (tool: string) =>
      results
        .filter((result) => result.toolName === tool)
        .flatMap((result) => result.content)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");

    expect(read("mcp__places__search_places")).toContain("Luigi's Trattoria");
    expect(read("bash")).toContain(HOURS_DONE);
    await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
    before = await messages(page).ariaSnapshot();
    await shot("web-transcript-before-quit", page);
  });

  const rendererBefore = await readRendererSpans(page);
  const trace = submitTrace(rendererBefore);
  const hostBefore = readSpans();
  const storage = await context.storageState();
  const chatUrl = new URL(page.url()).pathname;

  await test.step("quitting mid-answer stops the browser and the host", async () => {
    await expect(messages(page).getByText(HOURS_ANSWER)).toHaveCount(0);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
    quitAt = Date.now();
    await context.close();
    await host.close();
  });

  clearSpans();
  const reopenedHost = await open();
  const reopenedContext = await openContext(browser, storage);
  cleanup.defer(() => reopenedContext.close());
  const reopened = await reopenedContext.newPage();
  const reopenedErrors = collectErrors(reopened);
  await reopened.goto(`${reopenedHost.origin}${chatUrl}`);

  await test.step("the reopened chat renders the same settled frames", async () => {
    await expect(
      messages(reopened).getByRole("button", { name: "Ran 1 command, 2 tools" }),
    ).toBeVisible({ timeout: 30_000 });
    const after = await messages(reopened).ariaSnapshot();
    await shot("web-transcript-after-reopen", reopened);
    await writeFile(test.info().outputPath("web-transcript-before-quit.yml"), before);
    await writeFile(test.info().outputPath("web-transcript-after-reopen.yml"), after);
    expect(settledFrames(after, LAST_SETTLED)).toBe(settledFrames(before, LAST_SETTLED));
  });

  await test.step("the canvas, terminal and places result come back", async () => {
    const restored = messages(reopened)
      .getByRole("figure", { name: "Random pick nearby" })
      .frameLocator("iframe");
    await expect(restored.getByRole("heading", { name: "Luigi's Trattoria" })).toBeVisible();
    await expect(
      workbench(reopened).getByRole("textbox", { name: "Terminal input" }),
    ).toBeVisible();
    expect(await savedScrollback(reopened)).toContain(HOURS_DONE);
    await shot("web-terminal-after-reopen", reopened);
    await writeFile(
      test.info().outputPath("web-workbench-after-reopen.yml"),
      await workbench(reopened).ariaSnapshot(),
    );
    await reopened.keyboard.press("Control+`");
    await tabTo(messages(reopened).getByRole("button", { name: "Explored SKILL.md, ran 1 tool" }));
    await reopened.keyboard.press("Enter");
    const places = messages(reopened).getByRole("button", { name: "places: Search places" });
    await tabTo(places);
    await reopened.keyboard.press("Enter");
    await expect(places.locator("xpath=following::*[@aria-label='Tool output'][1]")).toContainText(
      "Luigi's Trattoria",
    );
  });

  await test.step("the resumed turn finishes the answer", async () => {
    await expect(messages(reopened).getByText(/It is open until 22:30 tonight/u)).toBeVisible({
      timeout: 30_000,
    });
    await shot("web-transcript-resumed", reopened);
  });

  await test.step("each hop of the submit stays within its budget", async () => {
    const run = await recordRun({
      surface: "web",
      trace,
      wallMs: quitAt - submitted,
      sources: [
        { process: "renderer", spans: rendererBefore },
        { process: "host", spans: hostBefore },
        { process: "mcp:places", spans: await readSpanFile(scenario.traceFile) },
      ],
      facts: { resumed: readSpans().filter((span) => span.name === "turn.start") },
    });

    if (!MEASURING) expectWithinBudgets(run.waterfall, "web");
  });

  expect(reopenedErrors).toEqual({ pageErrors: [], consoleErrors: [] });
});
