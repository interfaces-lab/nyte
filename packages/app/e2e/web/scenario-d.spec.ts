import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { CI_PROMPT, lastToolText, readSpanFile } from "@nyte-ai/host/bench";
import { enableTracing, readSpans } from "@nyte-ai/sdk";
import { collectErrors } from "../utils/errors.ts";
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
} from "./scenario-d.ts";
import { ciWebHost } from "./scenario-d-server.ts";

function messages(page: Page): Locator {
  return page.getByRole("region", { name: "Messages", exact: true });
}

function chatPane(page: Page): Locator {
  return page.getByRole("region", { name: "Active chat pane" });
}

function composer(page: Page): Locator {
  return page.getByLabel("Message", { exact: true });
}

function changes(page: Page): Locator {
  return page.getByRole("region", { name: "Workspace changes" });
}

async function selectScope(page: Page, current: RegExp, next: RegExp): Promise<void> {
  await press(changes(page).getByRole("button", { name: current }));
  await press(page.getByRole("menuitemradio", { name: next }));
  await expect(changes(page).getByRole("button", { name: next })).toBeVisible();
}

/** Dismisses the live notifications a finished run raised, which a reloaded page never shows. */
async function dismissNotifications(page: Page): Promise<void> {
  const notices = page.getByRole("region", { name: "Notifications" }).getByRole("dialog");

  for (let left = await notices.count(); left > 0; left -= 1) {
    await press(
      notices.first().getByRole("button", { name: "Dismiss notification", includeHidden: true }),
    );
    await expect(notices).toHaveCount(left - 1);
  }
}

/**
 * The transcript and the Changes panel as the accessibility tree, and the
 * main region's pixels with the composer's blinking caret masked. The
 * sidebar is left out: the open chat keeps the shelf it was opened on until
 * it is left, so a reload lists the finished chat under Done.
 */
async function captureFrame(page: Page): Promise<{ aria: string; image: Buffer }> {
  return {
    aria: `${await messages(page).ariaSnapshot()}\n${await changes(page).ariaSnapshot()}`,
    image: await page
      .getByRole("main")
      .screenshot({ animations: "disabled", caret: "hide", mask: [composer(page)] }),
  };
}

test.describe.configure({ timeout: 300_000 });

test("scenario D on the web: why did CI fail on my PR, fix it", async ({ page }) => {
  enableTracing();
  await using server = await ciWebHost("mcp");
  let errors = collectErrors(page);
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem("NYTE_TRACE", "1");
  });
  await page.goto(server.pairing);
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
  const log = messages(page);

  await test.step("a new chat in the repo asks why CI failed", async () => {
    await press(chatPane(page).getByRole("button", { name: "Home", exact: true }));
    await press(page.getByRole("menuitemradio", { name: "repo", exact: true }));
    await expect(chatPane(page).getByRole("button", { name: "repo", exact: true })).toBeVisible();
    await composer(page).focus();
    await expect(composer(page)).toHaveText("");
    await page.keyboard.type(CI_PROMPT);
    await expect(composer(page)).toHaveText(CI_PROMPT);
    await page.keyboard.press("Enter");
    await expect(log.getByText(/passes now/u)).toBeVisible({ timeout: 60_000 });
  });

  const read = server.fake.requests.map(lastToolText);

  await test.step("the skill picked the CI MCP server, and the transcript shows it", async () => {
    expect(server.route()).toBe("mcp");
    await press(log.getByRole("button", { name: /^Explored SKILL\.md, ran 2 tools$/u }));
    await expect(log.getByRole("button", { name: "ci: List check runs" })).toBeVisible();
    await expect(log.getByRole("button", { name: "ci: Get job logs" })).toBeVisible();
    await expect(log.getByText(/gh pr checks/u)).toHaveCount(0);
  });

  const logRow = { mountMs: 0 };

  await test.step("the model read the 5 MiB log's failing tail, and its row opens in a frame", async () => {
    const seen = read.find((text) => text.includes("characters cut from the middle"));

    expect(seen?.length).toBeLessThan(64 * 1024);
    expect(seen).toContain("-1 !== 3");
    expect(seen).toMatch(
      /##\[error\]Process completed with exit code 1\.\s*\[File get_job_logs\.txt, 5242\d{3} bytes, text\/plain\]$/u,
    );

    logRow.mountMs = await timeKeyToFrame(log.getByRole("button", { name: "ci: Get job logs" }), {
      label: "Tool output",
      text: "step 000001 ok",
    });

    expect(logRow.mountMs).toBeLessThanOrEqual(LOG_ROW_BUDGET_MS);
  });

  await test.step("the agent ran the failing test, and its failure came back into the turn", async () => {
    await press(log.getByRole("button", { name: /^Edited sum\.js, ran 2 commands, 1 tool$/u }));
    await press(log.getByRole("button", { name: "Ran Run the failing test" }));
    const output = log.getByRole("region", { name: "Command output" }).first();
    await expect(output).toContainText("✖ sum adds");
    await expect(output).toContainText("ℹ fail 1");
    expect(read.filter((text) => text.endsWith("[exit code 1]")).at(-1)).toContain("ℹ fail 1");
    expect(read.filter((text) => text.endsWith("[exit code 0]")).at(-1)).toMatch(/ℹ pass 1/u);
  });

  const canvas = log.getByRole("figure", { name: "CI failures" }).locator("iframe").contentFrame();

  await test.step("the canvas lists the failing test with file:line links", async () => {
    await expect(
      canvas.getByRole("row", { name: "sum adds test/sum.test.js:6 fail" }),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Open the job log" })).toHaveAttribute(
      "href",
      "https://ci.fixture.test/run/1/job/2",
    );
  });

  await test.step("a failure's link opens the file editor at its line", async () => {
    await press(canvas.getByRole("link", { name: "test/sum.test.js:6" }));
    const files = page.getByRole("tabpanel", { name: "test/sum.test.js" });
    await expect(files.getByRole("textbox", { name: "test/sum.test.js" })).toBeVisible();
    await press(files.getByRole("button", { name: "File options" }));
    await press(page.getByRole("menuitemcheckbox", { name: "Git Blame" }));
    await expect(files.getByText("Line 6", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });

  await test.step("the turn's Review opens the Changes panel on the agent's edit", async () => {
    await press(log.getByRole("button", { name: "Review" }));
    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(changes(page).getByRole("code")).toContainText("return a + b;");
  });

  const terminalOutput = join(server.home.home, "terminal.txt");

  await test.step("the user reruns the test in the Terminal and it passes", async () => {
    await press(page.getByRole("button", { name: "New workbench tab" }));
    await press(
      page
        .getByRole("menu", { name: "New workbench tab" })
        .getByRole("menuitem", { name: "Terminal" }),
    );
    const terminal = page.getByRole("tabpanel").getByRole("region", { name: "Terminal" });
    await expect(terminal.getByRole("status")).toHaveCount(0, { timeout: 30_000 });
    await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
    await page.keyboard.type(
      `${JSON.stringify(process.execPath)} --test 2>&1 | tee ${JSON.stringify(terminalOutput)}; exit\r`,
    );
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u, { timeout: 30_000 });
    expect(await readFile(terminalOutput, "utf8")).toMatch(/✔ sum adds[^]*ℹ pass 1[^]*ℹ fail 0/u);
  });

  await test.step("a commit through the commit bar lands, and the panel rereads git", async () => {
    await press(
      page.getByRole("tablist", { name: "Workbench tabs" }).getByRole("tab", { name: "Changes" }),
    );
    await selectScope(page, /^Latest/u, /^Uncommitted 1 file/u);
    await changes(page).getByRole("textbox", { name: "Commit message" }).focus();
    await page.keyboard.type("Fix sum");
    await page.keyboard.press("Enter");
    await expect(changes(page).getByRole("status").filter({ hasText: "Pushed." })).toBeVisible();
    await expect(
      changes(page).getByRole("button", { name: /^Uncommitted 0 files/u }),
    ).toBeVisible();
    expect(await git(server.repo.root, "log", "--format=%s")).toBe("Fix sum\nAdd sum\n");
    expect(await git(server.repo.root, "status", "--porcelain")).toBe("");
    expect(await git(server.repo.root, "rev-parse", "origin/fix-sum")).toBe(
      await git(server.repo.root, "rev-parse", "HEAD"),
    );
  });

  const rendererSpans = await readRendererSpans(page);
  const trace = submitTrace(rendererSpans);

  const { waterfall, hops } = scenarioWaterfall(trace, [
    { process: "renderer", spans: rendererSpans },
    { process: "host", spans: readSpans() },
    { process: "mcp:ci", spans: await readSpanFile(server.home.traceFile) },
  ]);

  const resumed = { ariaEqual: false, bytesEqual: false, changedPixels: -1 };
  const proofs = process.env.NYTE_WATERFALL_DIR;

  await test.step("a host restart and a reload bring back the same frame", async () => {
    await selectScope(page, /^Uncommitted/u, /^Latest/u);
    await press(log.getByRole("button", { name: /^Explored SKILL\.md, ran 2 tools$/u }));
    await press(log.getByRole("button", { name: /^Edited sum\.js, ran 2 commands, 1 tool$/u }));
    await expect(log.getByRole("region", { name: /output$/u })).toHaveCount(0);
    await pressUntilGone(chatPane(page).getByRole("button", { name: "Scroll to bottom" }));
    await dismissNotifications(page);
    await composer(page).focus();
    const before = await captureFrame(page);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });

    await server.restart();
    await page.reload();
    errors = collectErrors(page);
    await expect(messages(page).getByText(/passes now/u)).toBeVisible({ timeout: 30_000 });
    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(changes(page).getByRole("code")).toContainText("return a + b;");
    await expect(messages(page).getByRole("link", { name: "src/sum.js:2" })).toBeVisible();
    await expect(
      messages(page)
        .getByRole("figure", { name: "CI failures" })
        .locator("iframe")
        .contentFrame()
        .getByRole("link", { name: "test/sum.test.js:6" }),
    ).toBeVisible();
    await composer(page).focus();
    const after = await captureFrame(page);

    if (proofs !== undefined) {
      await mkdir(proofs, { recursive: true });
      await writeFile(join(proofs, "web-before-reload.yml"), before.aria);
      await writeFile(join(proofs, "web-after-reload.yml"), after.aria);
      await writeFile(join(proofs, "web-before-reload.png"), before.image);
      await writeFile(join(proofs, "web-after-reload.png"), after.image);
    }

    resumed.ariaEqual = after.aria === before.aria;
    resumed.bytesEqual = after.image.equals(before.image);
    resumed.changedPixels = await countChangedPixels(page, before.image, after.image);
    expect(after.aria).toBe(before.aria);
    expect(resumed.changedPixels, "pixels the resumed frame changed").toBe(0);
  });

  await test.step("after a restart, Uncommitted comes from git and the turn from its run's snapshots", async () => {
    await server.restart(() =>
      writeFile(join(server.repo.root, "NOTES.md"), "Written while the host was down.\n"),
    );
    await page.reload();
    errors = collectErrors(page);
    await expect(
      changes(page).getByRole("button", { name: "Latest 1 added, 1 removed" }),
    ).toBeVisible();
    await expect(changes(page).getByRole("button", { name: /NOTES\.md/u })).toHaveCount(0);
    await selectScope(page, /^Latest/u, /^Uncommitted 1 file/u);
    await expect(changes(page).getByRole("button", { name: "Collapse NOTES.md" })).toBeVisible();
    await expect(changes(page).getByRole("button", { name: /sum\.js/u })).toHaveCount(0);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
  });

  await test.step("every hop of the trace is within its budget", async () => {
    await saveProof("scenario-D-web", {
      waterfall,
      hops,
      facts: {
        scenario: "D",
        client: "web",
        prompt: CI_PROMPT,
        route: server.route(),
        trace,
        logRowMountMs: Math.round(logRow.mountMs * 10) / 10,
        logRowBudgetMs: LOG_ROW_BUDGET_MS,
        requests: server.fake.requests.length,
        resumed,
      },
    });
    await test
      .info()
      .attach("hops.md", { body: formatHopTable(hops), contentType: "text/markdown" });
    expect(new Set(waterfall.rows.map((row) => row.process))).toEqual(
      new Set(["renderer", "host", "mcp:ci"]),
    );
    expectWithinBudgets(hops);
  });
});

test("scenario D on the web without a CI server: the skill falls back to gh", async ({ page }) => {
  const path = process.env.PATH;
  await using server = await ciWebHost("gh");
  process.env.PATH = server.repo.path;

  try {
    const errors = collectErrors(page);
    await page.goto(server.pairing);
    await press(chatPane(page).getByRole("button", { name: "Home", exact: true }));
    await press(page.getByRole("menuitemradio", { name: "repo", exact: true }));
    await composer(page).focus();
    await page.keyboard.type(CI_PROMPT);
    await page.keyboard.press("Enter");
    const log = messages(page);
    await expect(log.getByText(/passes now/u)).toBeVisible({ timeout: 60_000 });
    expect(server.route()).toBe("gh");
    await press(log.getByRole("button", { name: /^Explored SKILL\.md/u }));
    await expect(
      log.getByRole("button", { name: "Ran List the pull request's checks" }),
    ).toBeVisible();
    await expect(log.getByRole("button", { name: "Ran Read the failing job's log" })).toBeVisible();
    await expect(log.getByRole("button", { name: /^ci: /u })).toHaveCount(0);
    expect(
      server.fake.requests
        .map(lastToolText)
        .find((text) => text.includes("##[error]Process completed")),
    ).toMatch(/^\[truncated: the first \d+ bytes of output are not shown\][^]*-1 !== 3/u);
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
  } finally {
    process.env.PATH = path;
  }
});
