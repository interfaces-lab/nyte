import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import {
  countChangedPixels,
  expectWithinBudgets,
  formatHopTable,
  git,
  LOG_ROW_BUDGET_MS,
  press,
  pressUntilGone,
  readRendererSpans,
  saveProof,
  scenarioWaterfall,
  submitTrace,
  timeKeyToFrame,
} from "@nyte-ai/app/e2e/scenario-d";
import { CI_PROMPT, readPrintedSpans, readSpanFile } from "@nyte-ai/bench";
import { launchDesktop } from "./launch.ts";
import { ciDesktopHome, readCiRequests } from "./scenario-d-home.ts";
import { chatPane, composer, messages } from "./ui.ts";

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

function workbenchTab(page: Page, name: string): Locator {
  return page.getByRole("tablist", { name: "Workbench tabs" }).getByRole("tab", { name });
}

function changes(page: Page): Locator {
  return workbench(page).getByRole("region", { name: "Workspace changes" });
}

async function captureFrame(page: Page): Promise<{ aria: string; image: Buffer }> {
  return {
    aria: `${await messages(page).ariaSnapshot()}\n${await workbench(page).ariaSnapshot()}`,
    image: await page
      .getByRole("main")
      .screenshot({ animations: "disabled", caret: "hide", mask: [composer(page)] }),
  };
}

async function dismissNotifications(page: Page): Promise<void> {
  const notices = page.getByRole("region", { name: "Notifications" }).getByRole("dialog");

  for (let left = await notices.count(); left > 0; left -= 1) {
    await press(
      notices.first().getByRole("button", { name: "Dismiss notification", includeHidden: true }),
    );
    await expect(notices).toHaveCount(left - 1);
  }
}

async function selectScope(page: Page, current: RegExp, next: RegExp): Promise<void> {
  await press(changes(page).getByRole("button", { name: current }));
  await press(page.getByRole("menuitemradio", { name: next }));
  await expect(changes(page).getByRole("button", { name: next })).toBeVisible();
}

test.describe.configure({ timeout: 300_000 });

test("scenario D on the desktop: why did CI fail on my PR, fix it", async () => {
  const testInfo = test.info();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-scenario-d-")));
  await using stack = new AsyncDisposableStack();
  stack.defer(() => rm(parent, { recursive: true, force: true }));
  const scenario = stack.use(await ciDesktopHome(parent, "mcp"));
  const appData = join(parent, "app-data");
  await mkdir(appData);
  let launches = 0;

  const launch = () => {
    launches += 1;

    return launchDesktop({
      home: scenario.home.home,
      parentDirectory: parent,
      appData,
      environment: { NYTE_TRACE: "stdout" },
    });
  };

  let launched = await launch();
  let closed = false;
  stack.defer(() => (closed ? undefined : launched.close()));
  let page = launched.page;
  await page.evaluate(() => localStorage.setItem("NYTE_TRACE", "1"));
  await page.reload();
  await page.locator("[data-nyte-shell]").waitFor();
  let errors = collectErrors(page);
  const log = messages(page);

  await test.step("a new chat in the repo asks why CI failed", async () => {
    await page.keyboard.press("ControlOrMeta+n");
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveText("");
    await press(chatPane(page).getByRole("button", { name: "Home", exact: true }));
    await press(page.getByRole("menuitemradio", { name: "repo", exact: true }));
    await expect(chatPane(page).getByRole("button", { name: "repo", exact: true })).toBeVisible();
    await composer(page).focus();
    await expect(composer(page)).toHaveText("");
    await page.keyboard.type(CI_PROMPT);
    await expect(composer(page)).toHaveText(CI_PROMPT);
    await page.keyboard.press("Enter");
    await expect(log.getByText(/passes now/u)).toBeVisible({ timeout: 60_000 });
    await expect(chatPane(page).getByRole("status").first()).toHaveText("Response finished");
  });

  const requests = readCiRequests(launched.output.join(""));

  await test.step("the skill picked the CI MCP server, and the transcript shows it", async () => {
    expect(requests.map((request) => request.tool)).toEqual([
      "user",
      "read",
      "mcp__ci__list_check_runs",
      "mcp__ci__get_job_logs",
      "canvas_render",
      "bash",
      "edit",
      "bash",
    ]);
    await press(log.getByRole("button", { name: /^Explored SKILL\.md, ran 2 tools$/u }));
    await expect(log.getByRole("link", { name: "Read SKILL.md" })).toBeVisible();
    await expect(log.getByRole("button", { name: "ci: List check runs" })).toBeVisible();
    await expect(log.getByRole("button", { name: "ci: Get job logs" })).toBeVisible();
    await expect(log.getByText(/gh pr checks/u)).toHaveCount(0);
  });

  const logRow = { mountMs: 0, outputChars: 0 };

  await test.step("the model read the 5 MiB log's failing tail, and its row opens in a frame", async () => {
    const read = requests.find((request) => request.tool === "mcp__ci__get_job_logs");

    expect(read?.clipped).toBe(true);
    expect(read?.chars).toBeLessThan(64 * 1024);
    expect(read?.tail).toContain("-1 !== 3");
    expect(read?.tail).toContain("TestContext.<anonymous> (test/sum.test.js:6:10)");
    expect(read?.tail).toMatch(
      /##\[error\]Process completed with exit code 1\.\s*\[File get_job_logs\.txt, 5242\d{3} bytes, text\/plain\]$/u,
    );

    logRow.mountMs = await timeKeyToFrame(log.getByRole("button", { name: "ci: Get job logs" }), {
      label: "Tool output",
      text: "step 000001 ok",
    });

    const output = log
      .getByRole("region", { name: "Tool output" })
      .filter({ hasText: "step 000001" });

    logRow.outputChars = (await output.textContent())?.length ?? 0;
    expect(logRow.mountMs).toBeLessThanOrEqual(LOG_ROW_BUDGET_MS);
    expect(logRow.outputChars).toBeLessThan(64 * 1024);
  });

  await test.step("the agent ran the failing test, and its failure came back into the turn", async () => {
    await press(log.getByRole("button", { name: /^Edited sum\.js, ran 2 commands, 1 tool$/u }));
    await press(log.getByRole("button", { name: "Run the failing test" }));
    const output = log.getByRole("region", { name: "Command output" }).first();
    await expect(output).toContainText("$ node --test");
    await expect(output).toContainText("✖ sum adds");
    await expect(output).toContainText("ℹ fail 1");

    const [failing, passing] = requests.filter((request) => request.tool === "bash");

    expect(failing?.tail).toMatch(/ℹ fail 1[^]*\[exit code 1\]$/u);
    expect(passing?.tail).toMatch(/ℹ pass 1[^]*\[exit code 0\]$/u);
  });

  const canvas = log.getByRole("figure", { name: "CI failures" }).locator("iframe").contentFrame();

  await test.step("the canvas lists the failing test with file:line links", async () => {
    await expect(
      canvas.getByRole("row", { name: "sum adds test/sum.test.js:6 fail" }),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "src/sum.js:2" })).toBeVisible();
    await expect(canvas.getByText(/-1 !== 3/u)).toBeVisible();
  });

  await test.step("a failure's link opens the file editor at its line", async () => {
    await press(canvas.getByRole("link", { name: "test/sum.test.js:6" }));
    const files = workbench(page).getByRole("tabpanel", { name: "test/sum.test.js" });
    await expect(files.getByRole("textbox", { name: "test/sum.test.js" })).toBeVisible();
    await press(files.getByRole("button", { name: "File options" }));
    await press(page.getByRole("menuitemcheckbox", { name: "Git Blame" }));
    await expect(files.getByText("Line 6", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });

  await test.step("the job log opens in the workbench browser", async () => {
    await press(canvas.getByRole("link", { name: "Open the job log" }));
    const browser = workbench(page).getByRole("tabpanel", { name: "Browser" });
    await expect(browser.getByRole("combobox", { name: "Address" })).toHaveValue(
      "ci.fixture.test/run/1/job/2",
    );
    await expect(browser.getByRole("alert")).toContainText("ERR_NAME_NOT_RESOLVED");
  });

  await test.step("the turn's Review opens the Changes panel on the agent's edit", async () => {
    await expect(log.getByRole("region", { name: "1 File Changed" })).toContainText("sum.js+1−1");
    await press(log.getByRole("button", { name: "Review" }));
    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(
      changes(page).getByRole("button", { name: /^Collapse src\/sum\.js/u }),
    ).toBeVisible();
    await expect(changes(page).getByRole("code")).toContainText("return a + b;");
  });

  const terminalOutput = join(parent, "terminal.txt");

  await test.step("the user reruns the test in the Terminal and it passes", async () => {
    await press(page.getByRole("button", { name: "New workbench tab" }));
    await press(
      page
        .getByRole("menu", { name: "New workbench tab" })
        .getByRole("menuitem", { name: "Terminal" }),
    );
    const terminal = workbench(page).getByRole("region", { name: "Terminal" });
    await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
    await page.keyboard.type(
      `${JSON.stringify(process.execPath)} --test 2>&1 | tee ${JSON.stringify(terminalOutput)}; exit\r`,
    );
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u, { timeout: 30_000 });
    expect(await readFile(terminalOutput, "utf8")).toMatch(/✔ sum adds[^]*ℹ pass 1[^]*ℹ fail 0/u);
  });

  await test.step("a commit through the commit bar lands, and the panel rereads git", async () => {
    await press(workbenchTab(page, "Changes"));
    await selectScope(page, /^Latest/u, /^Uncommitted 1 file/u);
    await changes(page).getByRole("textbox", { name: "Commit message" }).focus();
    await page.keyboard.type("Fix sum");
    await page.keyboard.press("Enter");
    await expect(
      changes(page).getByRole("button", { name: "Commit and Push Changes" }),
    ).toBeVisible();
    await expect(changes(page).getByRole("status").filter({ hasText: "Pushed." })).toBeVisible();
    await expect(
      changes(page).getByRole("button", { name: /^Uncommitted 0 files/u }),
    ).toBeVisible();
    await expect(changes(page).getByText("Working tree is clean")).toBeVisible();

    const repo = scenario.repo.root;
    expect(await git(repo, "log", "--format=%s")).toBe("Fix sum\nAdd sum\n");
    expect(await git(repo, "status", "--porcelain")).toBe("");
    expect(await git(repo, "rev-parse", "origin/fix-sum")).toBe(
      await git(repo, "rev-parse", "HEAD"),
    );
  });

  const hostSpans = readPrintedSpans(launched.output.join(""));
  const rendererSpans = await readRendererSpans(page);
  const trace = submitTrace(rendererSpans);

  const { waterfall, hops } = scenarioWaterfall(trace, [
    { process: "renderer", spans: rendererSpans },
    { process: "host", spans: hostSpans },
    { process: "mcp:ci", spans: await readSpanFile(scenario.home.traceFile) },
  ]);

  const proofs = process.env.NYTE_WATERFALL_DIR;
  const resumed = { ariaEqual: false, bytesEqual: false, changedPixels: -1 };

  await test.step("quit and resume brings back the same frame", async () => {
    await selectScope(page, /^Uncommitted/u, /^Latest/u);
    await press(log.getByRole("button", { name: /^Explored SKILL\.md, ran 2 tools$/u }));
    await press(log.getByRole("button", { name: /^Edited sum\.js, ran 2 commands, 1 tool$/u }));
    await expect(log.getByRole("region", { name: /output$/u })).toHaveCount(0);
    await pressUntilGone(chatPane(page).getByRole("button", { name: "Scroll to bottom" }));
    await dismissNotifications(page);
    await composer(page).focus();
    const before = await captureFrame(page);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });

    await launched.close();
    launched = await launch();
    page = launched.page;
    errors = collectErrors(page);
    await expect(messages(page).getByText(/passes now/u)).toBeVisible({ timeout: 30_000 });
    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(changes(page).getByRole("code")).toContainText("return a + b;");
    await expect(
      messages(page)
        .getByRole("figure", { name: "CI failures" })
        .locator("iframe")
        .contentFrame()
        .getByRole("link", { name: "test/sum.test.js:6" }),
    ).toBeVisible();
    await expect(messages(page).getByRole("link", { name: "src/sum.js:2" })).toBeVisible();
    await composer(page).focus();
    const after = await captureFrame(page);

    if (proofs !== undefined) {
      await mkdir(proofs, { recursive: true });
      await writeFile(join(proofs, "desktop-before-quit.yml"), before.aria);
      await writeFile(join(proofs, "desktop-after-resume.yml"), after.aria);
      await writeFile(join(proofs, "desktop-before-quit.png"), before.image);
      await writeFile(join(proofs, "desktop-after-resume.png"), after.image);
    }

    resumed.ariaEqual = after.aria === before.aria;
    resumed.bytesEqual = after.image.equals(before.image);
    resumed.changedPixels = await countChangedPixels(page, before.image, after.image);
    expect(after.aria).toBe(before.aria);
    expect(resumed.changedPixels, "pixels the resumed frame changed").toBe(0);
  });

  await test.step("after a resume, Uncommitted comes from git and the turn from its run's snapshots", async () => {
    await launched.close();
    await writeFile(join(scenario.repo.root, "NOTES.md"), "Written while Nyte was closed.\n");
    launched = await launch();
    page = launched.page;
    errors = collectErrors(page);

    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(
      changes(page).getByRole("button", { name: /^Collapse src\/sum\.js/u }),
    ).toBeVisible();
    await expect(changes(page).getByRole("button", { name: /NOTES\.md/u })).toHaveCount(0);

    await selectScope(page, /^Latest/u, /^Uncommitted 1 file/u);
    await expect(changes(page).getByRole("button", { name: "Collapse NOTES.md" })).toBeVisible();
    await expect(changes(page).getByRole("button", { name: /sum\.js/u })).toHaveCount(0);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
    await launched.close();
    closed = true;
  });

  await test.step("every hop of the trace is within its budget", async () => {
    const facts = {
      scenario: "D",
      client: "desktop",
      prompt: CI_PROMPT,
      route: "mcp",
      trace,
      logRowMountMs: Math.round(logRow.mountMs * 10) / 10,
      logRowBudgetMs: LOG_ROW_BUDGET_MS,
      logRowOutputChars: logRow.outputChars,
      modelSawLog: requests.find((request) => request.tool === "mcp__ci__get_job_logs") ?? null,
      resumed,
      launches,
    };

    await saveProof("scenario-D-desktop", { waterfall, hops, facts });
    await testInfo.attach("hops.md", { body: formatHopTable(hops), contentType: "text/markdown" });
    expect(new Set(waterfall.rows.map((row) => row.process))).toEqual(
      new Set(["renderer", "host", "mcp:ci"]),
    );
    expectWithinBudgets(hops);
  });
});
