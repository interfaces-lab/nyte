import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { caretStatus, closeWindow, editor, expect, goTo, test } from "./desk.ts";
import { readInputTrace } from "./input-trace.ts";
import { TRACE_CATEGORIES } from "./main-thread.ts";
import { percentile } from "./work-counts.ts";

const run = promisify(execFile);

const REFERENCE = join(homedir(), "Developer", "reference");

const FILES = [
  { source: "cobra/command.go", line: 1_000 },
  { source: "x-tools/gopls/internal/protocol/tsprotocol.go", line: 3_500 },
  { source: "x-tools/internal/stdlib/manifest.go", line: 9_000 },
] as const;

const TYPED = "\tvalue := strings.TrimSpace(name) // the quick brown fox";

const MARKS = { start: "nyte:core-typing:start", end: "nyte:core-typing:end" } as const;

test.use({
  opened: ["Code"],
  project: Object.fromEntries(
    FILES.map((file) => [`go/${file.source}`, join(REFERENCE, file.source)]),
  ),
});

test("typing, Enter and undo on real Go files", async ({ desk }, testInfo) => {
  test.setTimeout(300_000);
  const code = desk.page("Code");
  const results = [];

  await run("git", ["init", "-q"], { cwd: desk.home });
  await run("git", ["add", "go"], { cwd: desk.home });
  await run("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@nyte", "commit", "-qm", "base"], {
    cwd: desk.home,
  });
  await closeWindow(desk.application, desk.page("Nyte"));
  await (
    await desk.application.browserWindow(code)
  ).evaluate((window) => window.setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
  await desk.front(code);

  for (const file of FILES) {
    const path = `go/${file.source}`;
    const original = await readFile(join(desk.home, path), "utf8");
    const opening = performance.now();
    const text = await openByName(code, path);
    const openMs = Math.round(performance.now() - opening);

    await goTo(code, file.line, 1);

    if (process.env["NYTE_PROFILE"] !== undefined) {
      const profiler = await code.context().newCDPSession(code);

      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.setSamplingInterval", { interval: 100 });
      await profiler.send("Profiler.start");
      await code.keyboard.type(TYPED, { delay: 30 });
      const stopped = await profiler.send("Profiler.stop");

      await writeFile(
        testInfo.outputPath(`${slug(path)}.cpuprofile`),
        JSON.stringify(stopped.profile),
      );
      await profiler.detach();
      for (let index = 0; index < 200; index += 1) await code.keyboard.press("Meta+z");
    }

    await code.screenshot({ path: testInfo.outputPath(`${slug(path)}-1-goto.png`) });
    const typing = await traceKeys(code, testInfo.outputPath(`${slug(path)}-typing.json`), () =>
      code.keyboard.type(TYPED, { delay: 30 }),
    );
    await code.screenshot({ path: testInfo.outputPath(`${slug(path)}-2-typed.png`) });
    const enter = await traceKeys(
      code,
      testInfo.outputPath(`${slug(path)}-enter.json`),
      async () => {
        for (let index = 0; index < 10; index += 1)
          await code.keyboard.press("Enter", { delay: 30 });
      },
    );

    await code.screenshot({ path: testInfo.outputPath(`${slug(path)}-3-enter.png`) });
    await expect(caretStatus(code)).toHaveText(
      new RegExp(`^Ln ${String(file.line + 10)}, Col \\d+$`, "u"),
    );

    for (let index = 0; index < 200; index += 1) await code.keyboard.press("Meta+z");
    await code.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(desk.home, path), "utf8")).toBe(original);

    results.push({
      path,
      lines: original.split("\n").length,
      openMs,
      typing: latency(typing),
      enter: latency(enter),
    });
    await expect(text).toBeVisible();
  }

  const display = await desk.application.evaluate((electron) => {
    const shown = electron.screen.getPrimaryDisplay();

    return { hz: shown.displayFrequency, scale: shown.scaleFactor, size: shown.size };
  });

  await code.evaluate(() => {
    const field = document.createElement("textarea");

    field.id = "nyte-floor";
    field.style.cssText =
      "position:fixed;left:40px;top:120px;width:600px;height:200px;z-index:99999";
    document.body.append(field);
    field.focus();
  });
  const floor = await traceKeys(code, testInfo.outputPath("floor-typing.json"), () =>
    code.keyboard.type(TYPED, { delay: 30 }),
  );

  await code.evaluate(() => document.querySelector("#nyte-floor")?.remove());
  process.stdout.write(
    `editor-core floor: ${JSON.stringify({ display, textarea: latency(floor) })}\n`,
  );
  process.stdout.write(`editor-core: ${JSON.stringify(results)}\n`);
  await testInfo.attach("editor-core", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  await writeFile(testInfo.outputPath("editor-core.json"), JSON.stringify(results, null, 2));
  await expect(editor(code)).toBeVisible();
});

async function openByName(page: Page, path: string) {
  const name = path.split("/").at(-1) ?? path;

  await page.keyboard.press("Meta+p");
  const field = page.getByRole("combobox", { name: "Go to file" });

  await field.fill(path);
  await expect(page.getByRole("option", { name: new RegExp(name, "u") }).first()).toBeVisible();
  await field.press("Enter");
  const text = editor(page).getByRole("textbox", { name });

  await expect(text).toBeVisible();

  return text;
}

function slug(path: string): string {
  return path.replaceAll("/", "-");
}

function latency(keys: readonly number[]) {
  return {
    p50: percentile(keys, 0.5),
    p95: percentile(keys, 0.95),
    max: Math.max(0, ...keys),
    keys: keys.length,
  };
}

async function traceKeys(
  page: Page,
  path: string,
  type: () => Promise<void>,
): Promise<readonly number[]> {
  const session = await page.context().newCDPSession(page);
  const events: unknown[] = [];

  session.on("Tracing.dataCollected", (event) => events.push(...event.value));
  await session.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    transferMode: "ReportEvents",
  });
  await page.evaluate((name) => performance.mark(name), MARKS.start);
  await type();
  await page.evaluate((name) => performance.mark(name), MARKS.end);

  const complete = new Promise<void>((done) =>
    session.once("Tracing.tracingComplete", () => done()),
  );

  await session.send("Tracing.end");
  await complete;
  await session.detach();
  await writeFile(path, JSON.stringify({ traceEvents: events }));

  return (await readInputTrace(path, MARKS)).keydownMs;
}

test("Go to Line takes the keys typed the moment it opens", async ({ desk }) => {
  const code = desk.page("Code");

  await closeWindow(desk.application, desk.page("Nyte"));
  await desk.front(code);
  await openByName(code, `go/${FILES[2].source}`);
  const landed = [];

  for (const line of [1_000, 5_000, 9_999, 12_345, 18_000, 3, 777, 15_000, 42, 8_888]) {
    await caretStatus(code).click();
    await code.keyboard.type(`${String(line)}:1`);
    await code.keyboard.press("Enter");
    await expect(code.getByRole("combobox", { name: "Go to file" })).toBeHidden();
    landed.push({ line, shown: await caretStatus(code).textContent() });
  }

  expect(landed.filter((entry) => entry.shown !== `Ln ${String(entry.line)}, Col 1`)).toEqual([]);
});

test("double-click selects the word under the pointer", async ({ desk }) => {
  const code = desk.page("Code");

  await closeWindow(desk.application, desk.page("Nyte"));
  await desk.front(code);
  const text = await openByName(code, `go/${FILES[0].source}`);
  const words = ["package", "cobra", "import", "const", "FlagSetByCobraAnnotation", "helpFlagName"];
  const results = [];

  for (let round = 0; round < 3; round += 1)
    for (const word of words) {
      await text.getByText(word, { exact: true }).first().dblclick();
      await code.keyboard.press("Meta+c");
      results.push({
        word,
        copied: await desk.application.evaluate((electron) => electron.clipboard.readText()),
      });
    }

  expect(results.filter((entry) => entry.copied !== entry.word)).toEqual([]);
});

test("captures of the editor mid-edit, light and dark", async ({ desk }, testInfo) => {
  test.setTimeout(300_000);
  const code = desk.page("Code");

  await (
    await desk.application.browserWindow(code)
  ).evaluate((window) => window.setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
  await desk.front(code);
  await openByName(code, `go/${FILES[0].source}`);
  await goTo(code, 1001, 13);
  await code.keyboard.press("Meta+d");
  await code.keyboard.press("Meta+d");
  await goTo(code, 1003, 1);
  await code.keyboard.press("End");
  await code.keyboard.press("Enter");
  await code.keyboard.type('log.Printf("pre-run: %v');

  for (const theme of ["dark", "light"] as const) {
    await desk.setTheme(theme);
    await desk.tile();
    await desk.front(code);
    const path = await desk.capture(code, `editor-${theme}`);

    await testInfo.attach(`editor-${theme}`, { path, contentType: "image/png" });
  }
});
