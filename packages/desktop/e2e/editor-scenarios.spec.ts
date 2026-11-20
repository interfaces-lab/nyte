import { expect, test } from "@playwright/test";
import type { CDPSession, ElectronApplication, JSHandle, Page } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { caretStatus, closeWindow, editor, goTo } from "./desk.ts";
import { readInputTrace } from "./input-trace.ts";
import { launchDesktop } from "./launch.ts";
import { TRACE_CATEGORIES } from "./main-thread.ts";
import { openChat } from "./ui.ts";
import { percentile } from "./work-counts.ts";

const OUT = process.env["NYTE_PIERRE_OUT"];

const LABEL = process.env["NYTE_PIERRE_LABEL"] ?? "run";

const TS_PROJECT = process.env["NYTE_PIERRE_TS"] ?? "/tmp/nyte-pierre-right-ts";

const REPOSITORY = resolve(import.meta.dirname, "../../..");

const TYPED = " /* the quick brown fox jumps over the lazy dog */";

const MARKS = { start: "nyte:scenario-typing:start", end: "nyte:scenario-typing:end" } as const;

const SETTLE_MS = 8_000;

const SWITCH_ROUNDS = 3;

const JUMP_SAMPLES = 8;

const WHEELS = 120;

const run = promisify(execFile);

const UNITS = new Map([
  ["B", 1 / 1024 / 1024],
  ["KB", 1 / 1024],
  ["MB", 1],
  ["GB", 1024],
]);

interface Scenario {
  readonly name: string;
  readonly copy: Readonly<Record<string, string>>;
  readonly tabs: readonly string[];
  readonly largest: string;
  readonly typing: { readonly path: string; readonly line: number };
  readonly typingLargest: { readonly line: number };
  readonly jumps: {
    readonly path: string;
    readonly warm: readonly [string, string];
    readonly lands: RegExp;
    readonly targets: readonly (readonly [string, string])[];
  };
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "go",
    copy: { cobra: "/tmp/cobra", xtools: "/tmp/xtools" },
    tabs: [
      "cobra/command.go",
      "cobra/completions.go",
      "cobra/flag_groups.go",
      "cobra/cobra.go",
      "xtools/go/packages/packages.go",
      "xtools/internal/gocommand/invoke.go",
      "xtools/gopls/internal/cache/snapshot.go",
      "xtools/go/ssa/func.go",
    ],
    largest: "xtools/internal/stdlib/manifest.go",
    typing: { path: "cobra/command.go", line: 1_000 },
    typingLargest: { line: 9_000 },
    jumps: {
      path: "cobra/command.go",
      warm: ["return commandFound, a, legacyArgs(", "legacyArgs"],
      lands: /^cobra\/args\.go/u,
      targets: [
        ["return commandFound, a, legacyArgs(", "legacyArgs"],
        ["argsWOflags := stripFlags(innerArgs, c)", "stripFlags"],
        ["if EnablePrefixMatching && cmd.hasNameOrAliasPrefix(next)", "EnablePrefixMatching"],
      ],
    },
  },
  {
    name: "typescript",
    copy: { ts: TS_PROJECT },
    tabs: [
      "ts/editor/file-editor.tsx",
      "ts/editor/editor-panel.tsx",
      "ts/editor/file-store.ts",
      "ts/editor/declaration-popups.tsx",
      "ts/editor/use-declarations.ts",
      "ts/core/tool-runner.ts",
      "ts/desktop/index.ts",
    ],
    largest: "ts/host/store-conformance.ts",
    typing: { path: "ts/editor/file-editor.tsx", line: 500 },
    typingLargest: { line: 500 },
    jumps: {
      path: "ts/editor/file-editor.tsx",
      warm: ["replaceContents(editor, contents);", "replaceContents"],
      lands: /^ts\/editor\/outside-edits\.ts/u,
      targets: [
        ["replaceContents(editor, contents);", "replaceContents"],
        ["() => createFileDocument(document)", "createFileDocument"],
        [": visualColumn(lineText, focus.character, TAB_COLUMNS) + 1,", "visualColumn"],
      ],
    },
  },
];

test.skip(OUT === undefined, "A bench: set NYTE_PIERRE_OUT to run it.");
test.skip(process.platform !== "darwin", "Memory is macOS's phys_footprint.");

for (const scenario of SCENARIOS)
  // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright reads a test's fixtures from this pattern, and the bench launches its own app
  test(`the Code window on a ${scenario.name} project`, async ({}, testInfo) => {
    test.setTimeout(900_000);
    await using stack = new AsyncDisposableStack();
    const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-scenario-")));
    stack.defer(() => rm(parent, { recursive: true, force: true }));
    const home = (await prepareHome(parent)).home;

    await prepareProject(home, scenario);
    const launched = await launchDesktop({ home, parentDirectory: parent, background: true });
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
    code.on("pageerror", (error) =>
      process.stdout.write(`page error: ${error.stack ?? error.message}\n`),
    );
    code.on("console", (message) => {
      if (message.type() === "error") process.stdout.write(`console error: ${message.text()}\n`);
    });
    await code.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
    await closeWindow(application, launched.page);
    await (
      await application.browserWindow(code)
    ).evaluate((window) => window.setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
    const session = await code.context().newCDPSession(code);
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await expect.poll(() => code.evaluate(() => document.hasFocus())).toBe(true);
    await editor(code).waitFor();
    const pid = await (
      await application.browserWindow(code)
    ).evaluate((window) => window.webContents.getOSProcessId());

    await focusExplorer(code, scenario.tabs[0] ?? scenario.largest);
    await code.waitForTimeout(SETTLE_MS);
    const empty = await memory(application, session, pid);

    const opens = [];

    for (const path of [...scenario.tabs, scenario.largest]) {
      const ms = await openTimed(code, path).catch(async (cause: unknown) => {
        await code.screenshot({ path: testInfo.outputPath(`open-failed.png`) });
        throw cause;
      });

      opens.push({ path, ms });
      process.stdout.write(`opened ${path} in ${String(ms)} ms\n`);
    }

    await code.waitForTimeout(SETTLE_MS);
    const idle = await memory(application, session, pid);

    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });
    await session.send("Profiler.start");

    for (const path of [...scenario.tabs, scenario.largest]) await switchTimed(code, path);

    await writeFile(
      testInfo.outputPath(`${scenario.name}-switch.cpuprofile`),
      JSON.stringify((await session.send("Profiler.stop")).profile),
    );
    await session.send("Profiler.disable");
    const switches = [];

    for (let round = 0; round < SWITCH_ROUNDS; round += 1)
      for (const path of [...scenario.tabs, scenario.largest])
        switches.push(await switchTimed(code, path));

    await switchTimed(code, scenario.typing.path);
    const typing = await typeTimed(
      code,
      session,
      scenario.typing.line,
      testInfo.outputPath(`${scenario.name}-typical`),
    );
    const scrolling = await scrollTimed(code);

    await switchTimed(code, scenario.largest);
    const typingLargest = await typeTimed(
      code,
      session,
      scenario.typingLargest.line,
      testInfo.outputPath(`${scenario.name}-largest`),
    );
    const scrollingLargest = await scrollTimed(code);

    const floor = await floorTimed(code, testInfo.outputPath(`${scenario.name}-floor`));
    const jumps = await timeJumps(code, home, scenario);

    await code.waitForTimeout(SETTLE_MS / 2);
    const worked = await memory(application, session, pid);

    const display = await application.evaluate((electron) => {
      const shown = electron.screen.getPrimaryDisplay();

      return { hz: shown.displayFrequency, scale: shown.scaleFactor };
    });

    const report = {
      label: LABEL,
      scenario: scenario.name,
      display,
      memory: { empty, idle, worked },
      coldOpenMs: {
        files: opens,
        ...summary(opens.slice(1, -1).map((entry) => entry.ms)),
        largest: opens.at(-1)?.ms,
      },
      switchMs: summary(switches.map((entry) => entry.ms)),
      switchLargestMs: summary(
        switches.filter((entry) => entry.path === scenario.largest).map((entry) => entry.ms),
      ),
      typing: { path: scenario.typing.path, ...typing },
      typingLargest: { path: scenario.largest, ...typingLargest },
      textareaKeyToScreenMs: floor,
      scrollFrameMs: scrolling,
      scrollFrameLargestMs: scrollingLargest,
      declarationMs: summary(jumps),
    };

    if (OUT !== undefined) {
      await mkdir(OUT, { recursive: true });
      await writeFile(join(OUT, `${LABEL}-${scenario.name}.json`), JSON.stringify(report, null, 2));
    }

    process.stdout.write(`editor-scenario: ${JSON.stringify(report)}\n`);
    await testInfo.attach("scenario", {
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

async function prepareProject(home: string, scenario: Scenario): Promise<void> {
  for (const [name, source] of Object.entries(scenario.copy))
    await cp(source, join(home, name), {
      recursive: true,
      filter: (path) => !path.includes("/.git"),
    });

  const tool = (name: string): string =>
    execFileSync("mise", ["which", name], { encoding: "utf8" }).trim();
  const go = tool("go");
  const modules = execFileSync(go, ["env", "GOMODCACHE"], { encoding: "utf8" }).trim();
  const folders = [tool("gopls"), go, tool("node"), tool("typescript-language-server")].map(
    (path) => dirname(path),
  );

  await writeFile(
    join(home, ".zshenv"),
    [
      `export PATH="${[...new Set(folders)].join(":")}:$PATH"`,
      `export GOMODCACHE="${modules}"`,
      "export GOPROXY=off GOTOOLCHAIN=local",
      "",
    ].join("\n"),
  );

  if (scenario.copy["ts"] !== undefined) {
    await mkdir(join(home, "ts", "node_modules"), { recursive: true });
    await symlink(
      join(REPOSITORY, "node_modules", "typescript"),
      join(home, "ts", "node_modules", "typescript"),
    );
  }
}

async function armPainted(
  page: Page,
  path: string,
  input: "keydown" | "pointerdown",
): Promise<JSHandle<{ readonly pending: Promise<number> }>> {
  return page.evaluateHandle(
    (armed) => ({
      pending: new Promise<number>((done, fail) => {
        window.addEventListener(
          armed.input,
          (event) => {
            const started = event.timeStamp;
            const tick = (): void => {
              if (
                [
                  ...document.querySelectorAll(
                    '[data-editor-panel] [role="tabpanel"]:not([hidden])',
                  ),
                ]
                  .filter((panel) => panel.checkVisibility())
                  .some((panel) =>
                    [...panel.querySelectorAll("diffs-container")].some((host) => {
                      const textbox = host.shadowRoot?.querySelector('[role="textbox"]');

                      return (
                        textbox?.getAttribute("aria-label") === armed.path &&
                        textbox.querySelector("[data-line]") !== null
                      );
                    }),
                  )
              )
                done(performance.now() - started);
              else if (performance.now() - started > 20_000)
                fail(new Error(`${armed.path} never drew`));
              else requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
          },
          { capture: true, once: true },
        );
      }),
    }),
    { path, input },
  );
}

async function painted(armed: JSHandle<{ readonly pending: Promise<number> }>): Promise<number> {
  return Math.round(await armed.evaluate((state) => state.pending));
}

async function focusExplorer(page: Page, path: string): Promise<void> {
  const files = editor(page);
  const explorer = files.getByRole("button", { name: "Editor Sidebar", pressed: false });

  await expect(explorer.or(files.getByRole("treeitem").first())).toBeVisible();

  if (await explorer.isVisible()) await explorer.click();
  await files
    .getByRole("treeitem", { name: path.split("/")[0] ?? path, exact: true })
    .first()
    .click();
}

async function openTimed(page: Page, path: string): Promise<number> {
  const selected = editor(page).getByRole("tab", { selected: true });

  if ((await selected.count()) > 0) await selected.click();
  await page.keyboard.press("Meta+p");
  const field = page.getByRole("combobox");

  await field.fill(path);
  await expect(page.getByRole("option").first()).toContainText(path.split("/").at(-1) ?? path);
  const armed = await armPainted(page, path, "keydown");
  await field.press("Enter");

  return painted(armed);
}

async function switchTimed(
  page: Page,
  path: string,
): Promise<{ readonly path: string; readonly ms: number }> {
  const tab = editor(page).getByRole("tab", {
    name: new RegExp(`^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
  });

  const armed = await armPainted(page, path, "pointerdown");
  await tab.click();

  return { path, ms: await painted(armed) };
}

async function typeTimed(page: Page, session: CDPSession, line: number, prefix: string) {
  await goTo(page, line, 1);
  const keys = await traceKeys(page, `${prefix}-typing-trace.json`, () =>
    page.keyboard.type(TYPED, { delay: 40 }),
  );
  const enters = await traceKeys(page, `${prefix}-enter-trace.json`, async () => {
    for (let index = 0; index < 10; index += 1) await page.keyboard.press("Enter", { delay: 40 });
  });

  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  const started = performance.now();
  await page.keyboard.type(TYPED, { delay: 40 });
  const elapsed = performance.now() - started;
  const profile = (await session.send("Profiler.stop")).profile;

  await session.send("Profiler.disable");
  await writeFile(`${prefix}.cpuprofile`, JSON.stringify(profile));

  for (let index = 0; index < TYPED.length * 2 + 12; index += 1)
    await page.keyboard.press("Meta+z");
  await expect(caretStatus(page)).toBeVisible();

  return {
    keyToScreenMs: latency(keys.keydownMs),
    enterToScreenMs: latency(enters.keydownMs),
    renderPhaseMs: latency(keys.renderingMs),
    longTasks: keys.longTasks.length + enters.longTasks.length,
    mainThreadMsPerKey: Math.round((busyMs(profile) / TYPED.length) * 100) / 100,
    profiledMs: Math.round(elapsed),
  };
}

function busyMs(profile: {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: { readonly functionName: string };
  }[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}): number {
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let total = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const name = names.get(samples[index] ?? -1);

    if (name !== "(idle)" && name !== "(program)") total += (deltas[index] ?? 0) / 1_000;
  }

  return total;
}

async function floorTimed(page: Page, prefix: string) {
  await page.evaluate(() => {
    const field = document.createElement("textarea");

    field.id = "nyte-floor";
    field.style.cssText =
      "position:fixed;left:40px;top:120px;width:600px;height:200px;z-index:99999";
    document.body.append(field);
    field.focus();
  });
  const keys = await traceKeys(page, `${prefix}-trace.json`, () =>
    page.keyboard.type(TYPED, { delay: 40 }),
  );

  await page.evaluate(() => document.querySelector("#nyte-floor")?.remove());

  return latency(keys.keydownMs);
}

async function scrollTimed(page: Page) {
  const box = await editor(page).locator('[role="tabpanel"]:not([hidden])').boundingBox();

  if (box === null) throw new Error("No editor to scroll.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const recording = await page.evaluateHandle(() => {
    const times: number[] = [];
    const state = { times, recording: true };
    const tick = (time: number): void => {
      times.push(time);

      if (state.recording) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);

    return state;
  });

  for (let step = 0; step < WHEELS; step += 1) {
    await page.mouse.wheel(0, step < WHEELS / 2 ? 80 : -80);
    await page.waitForTimeout(8);
  }

  const times = await recording.evaluate((state) => {
    state.recording = false;

    return state.times;
  });
  const deltas = times.slice(1).map((time, index) => time - (times[index] ?? time));

  return {
    p50: round(percentile(deltas, 0.5)),
    p95: round(percentile(deltas, 0.95)),
    over33: deltas.filter((delta) => delta > 33.4).length,
    frames: deltas.length,
  };
}

async function timeJumps(page: Page, home: string, scenario: Scenario): Promise<readonly number[]> {
  const text = await readFile(join(home, scenario.jumps.path), "utf8");

  await switchTimed(page, scenario.jumps.path);
  const warm = find(text, scenario.jumps.warm[0], scenario.jumps.warm[1]);

  await goTo(page, warm.line, warm.column);
  await expect(async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+B");
    await expect(editor(page).getByRole("tab", { selected: true })).toHaveAccessibleName(
      scenario.jumps.lands,
      {
        timeout: 3_000,
      },
    );
  }).toPass({ timeout: 180_000 });
  await page.keyboard.press("Escape");
  await switchTimed(page, scenario.jumps.path);

  const times: number[] = [];

  for (const target of scenario.jumps.targets) {
    const at = find(text, target[0], target[1]);
    const origin = `Ln ${String(at.line)}, Col ${String(at.column)}`;

    await goTo(page, at.line, at.column);

    for (let round = 0; round <= JUMP_SAMPLES; round += 1) {
      const landing = await page.evaluateHandle((from) => {
        const status = (): string =>
          [...document.querySelectorAll('[role="tabpanel"]:not([hidden]) button')]
            .filter((button) => button.checkVisibility())
            .map((button) => button.textContent)
            .find((label) => /^Ln \d+, Col \d+$/u.test(label)) ?? "";

        return {
          pending: new Promise<number>((done, fail) => {
            window.addEventListener(
              "keydown",
              (event) => {
                const started = event.timeStamp;
                const tick = (): void => {
                  const shown = status();

                  if (shown !== from && shown !== "") done(performance.now() - started);
                  else if (performance.now() - started > 10_000)
                    fail(new Error(`⌘B from ${from} landed nowhere`));
                  else requestAnimationFrame(tick);
                };

                requestAnimationFrame(tick);
              },
              { capture: true, once: true },
            );
          }),
        };
      }, origin);
      await page.keyboard.press("Meta+B");
      const ms = await landing.evaluate((state) => state.pending);

      if (round > 0) times.push(Math.round(ms));
      await page.keyboard.press("Meta+BracketLeft");
      await expect(caretStatus(page)).toHaveText(origin);
    }
  }

  return times;
}

async function memory(application: ElectronApplication, session: CDPSession, pid: number) {
  const window = await megabytes(pid);

  await session.send("HeapProfiler.collectGarbage");
  await new Promise((done) => setTimeout(done, 1_000));
  await session.send("HeapProfiler.collectGarbage");
  await new Promise((done) => setTimeout(done, 2_000));
  const heap = await session.send("Runtime.getHeapUsage");
  const afterGc = await megabytes(pid);
  const own = await application.evaluate((electron) =>
    electron.app.getAppMetrics().map((entry) => ({ kind: entry.type, pid: entry.pid })),
  );
  const all = await Promise.all(
    own.map(async (entry) => ({ kind: entry.kind, megabytes: await megabytes(entry.pid) })),
  );

  return {
    codeWindowMb: window,
    codeWindowAfterGcMb: afterGc,
    mainHeapMb: Math.round(heap.usedSize / 1024 / 1024),
    appTotalMb: all.reduce((sum, entry) => sum + entry.megabytes, 0),
    byKind: Object.fromEntries(
      [...new Set(all.map((entry) => entry.kind))].map((kind) => [
        kind,
        all.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.megabytes, 0),
      ]),
    ),
  };
}

async function megabytes(pid: number): Promise<number> {
  const read = await run("/usr/bin/footprint", ["-p", String(pid)]).catch(() => ({ stdout: "" }));
  const found = /phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)\b/u.exec(read.stdout);

  return Math.round(Number(found?.[1] ?? 0) * (UNITS.get(found?.[2] ?? "MB") ?? 1));
}

async function traceKeys(page: Page, path: string, type: () => Promise<void>) {
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

  return readInputTrace(path, MARKS);
}

function latency(values: readonly number[]) {
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(0, ...values)),
    count: values.length,
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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const TAB_COLUMNS = 4;

function find(
  text: string,
  line: string,
  name: string,
): { readonly line: number; readonly column: number } {
  const lines = text.split("\n");
  const index = lines.findIndex((each) => each.includes(line));
  const found = lines[index] ?? "";
  const start = found.indexOf(line);
  const word = new RegExp(`\\b${name}\\b`, "u").exec(found.slice(start));

  if (index < 0 || word === null) throw new Error(`"${line}" isn't in the file.`);
  let column = 0;

  for (const character of found.slice(0, start + word.index))
    column = character === "\t" ? column + TAB_COLUMNS - (column % TAB_COLUMNS) : column + 1;

  return { line: index + 1, column: column + 1 };
}
