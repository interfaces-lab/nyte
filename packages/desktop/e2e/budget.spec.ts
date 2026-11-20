import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { ElectronApplication, Page } from "@playwright/test";
import { SWARM_AGENTS, WARM_REPLY } from "../src/host/fixtures/e2e-models.ts";
import { board, boardStill, expect, goTo, openFile, RADIUS_END, test, zoomBoard } from "./desk.ts";
import { readInputTrace } from "./input-trace.ts";
import { TRACE_CATEGORIES } from "./main-thread.ts";
import { messages, send } from "./ui.ts";
import { percentile } from "./work-counts.ts";

const IDLE_MB = 1_500;

const WORKING_MB = 2_500;

const HEAVY_MB = 4_000;

const WINDOW_MB = 300;

const KEY_P95_MS = 50;

const DRAIN_MS = 8_000;

const SETTLE_MS = 4_000;

const HEAVY_FRAMES = 1_000;

const HUGE_LINES = 100_000;

const HUGE_FILE = "huge/records.go";

const TYPED = " /* the quick brown fox jumps over the lazy dog */";

const MARKS = { start: "nyte:budget-typing:start", end: "nyte:budget-typing:end" } as const;

const run = promisify(execFile);

const UNITS = new Map([
  ["B", 1 / 1024 / 1024],
  ["KB", 1 / 1024],
  ["MB", 1],
  ["GB", 1024],
]);

interface Process {
  readonly kind: string;
  readonly megabytes: number;
}

const HUGE_FOLDER = mkdtempSync(join(tmpdir(), "nyte-budget-huge-"));

writeFileSync(join(HUGE_FOLDER, "records.go"), hugeGo(HUGE_LINES));

test.use({ opened: ["Code", "Studio"], project: { huge: HUGE_FOLDER } });

test.afterAll(() => rmSync(HUGE_FOLDER, { recursive: true, force: true }));

test.skip(
  process.platform !== "darwin",
  "The budgets are of macOS's phys_footprint, what Activity Monitor shows.",
);

test("three windows hold the memory budget, idle, working and on a heavy board, and keys reach the screen in time", async ({
  desk,
}, testInfo) => {
  test.setTimeout(300_000);
  const nyte = desk.page("Nyte");
  const code = desk.page("Code");
  const studio = desk.page("Studio");
  const measure = () => footprint(desk.application);

  await expect(board(studio).locator('[data-frame="Tonight"]')).toBeVisible();
  await desk.front(code);
  const sheet = await openFile(code, "design/tokens.css");

  await desk.tile();
  await boardStill(studio);
  await nyte.waitForTimeout(DRAIN_MS);
  const idle = await measure();

  await desk.front(nyte);
  await send(nyte, "/warm");
  await expect(messages(nyte).getByText(WARM_REPLY)).toBeVisible();
  await send(nyte, "/swarm");
  await expect(
    nyte.getByRole("button", { name: new RegExp(`^Agents ${String(SWARM_AGENTS)}\\b`, "u") }),
  ).toBeVisible();

  await desk.front(code);
  await goTo(code, RADIUS_END.line, RADIUS_END.column);

  const keys = await traceKeys(code, testInfo.outputPath("typing-trace.json"), () =>
    code.keyboard.type(TYPED, { delay: 40 }),
  );

  await code.keyboard.press("ControlOrMeta+s");
  await expect(sheet).toContainText(TYPED.trim());

  await openFile(code, HUGE_FILE);
  await goTo(code, HUGE_LINES / 2, 1);

  const hugeKeys = await traceKeys(code, testInfo.outputPath("huge-typing-trace.json"), () =>
    code.keyboard.type(TYPED, { delay: 40 }),
  );

  const working = await measure();

  await nyte.waitForTimeout(SETTLE_MS);
  const beforeWindow = await measure();

  const opening = desk.application.waitForEvent("window");

  await desk.application.evaluate((electron) => {
    const items = (electron.Menu.getApplicationMenu()?.items ?? []).flatMap(
      (item) => item.submenu?.items ?? [],
    );

    items.find((item) => item.label === "New Window")?.click();
  });
  const extra = await opening;

  await extra.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
  await nyte.waitForTimeout(SETTLE_MS);
  const withWindow = await measure();
  await (await desk.application.browserWindow(extra)).evaluate((window) => window.close());

  const frames = board(studio).locator("[data-frame-box]");
  const drawn = await frames.count();

  await writeFile(join(desk.home, "design", "screens", "tonight.jsx"), heavyDesign(HEAVY_FRAMES));
  await expect(frames).toHaveCount(drawn - 2 + HEAVY_FRAMES, { timeout: 60_000 });
  await zoomBoard(studio, "Zoom to Fit");
  await nyte.waitForTimeout(SETTLE_MS);
  const heavy = await measure();
  await desk.capture(studio, "heavy-board");

  const report = {
    idle: summary(idle),
    working: summary(working),
    extraWindow: {
      added: total(withWindow) - total(beforeWindow),
      processes: withWindow.length - beforeWindow.length,
    },
    heavy: { ...summary(heavy), frames: drawn - 2 + HEAVY_FRAMES },
    keyToScreenMs: latency(keys),
    hugeFileKeyToScreenMs: { ...latency(hugeKeys), lines: HUGE_LINES },
  };

  process.stdout.write(`budget: ${JSON.stringify(report)}\n`);
  await testInfo.attach("budget", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  expect(report.keyToScreenMs.keys).toBeGreaterThanOrEqual(Math.floor(TYPED.length * 0.9));
  expect(report.hugeFileKeyToScreenMs.keys).toBeGreaterThanOrEqual(Math.floor(TYPED.length * 0.9));
  expect(report.idle.total).toBeLessThanOrEqual(IDLE_MB);
  expect(report.working.total).toBeLessThanOrEqual(WORKING_MB);
  expect(report.heavy.total).toBeLessThanOrEqual(HEAVY_MB);
  expect(report.extraWindow.added).toBeLessThanOrEqual(WINDOW_MB);
  expect(report.keyToScreenMs.p95).toBeLessThanOrEqual(KEY_P95_MS);
  expect(report.hugeFileKeyToScreenMs.p95).toBeLessThanOrEqual(KEY_P95_MS);
});

async function footprint(application: ElectronApplication): Promise<readonly Process[]> {
  const own = await application.evaluate((electron) =>
    electron.app.getAppMetrics().map((entry) => ({ kind: entry.type, pid: entry.pid })),
  );

  return Promise.all(
    own.map(async (entry) => ({
      kind: entry.kind === "Tab" ? "Renderer" : entry.kind,
      megabytes: await megabytes(entry.pid),
    })),
  );
}

function latency(keys: readonly number[]) {
  return {
    p50: percentile(keys, 0.5),
    p95: percentile(keys, 0.95),
    max: Math.max(0, ...keys),
    keys: keys.length,
  };
}

async function megabytes(pid: number): Promise<number> {
  const read = await run("/usr/bin/footprint", ["-p", String(pid)]).catch(() => ({ stdout: "" }));
  const found = /phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)\b/u.exec(read.stdout);

  return Math.round(Number(found?.[1] ?? 0) * (UNITS.get(found?.[2] ?? "MB") ?? 1));
}

function total(processes: readonly Process[]): number {
  return processes.reduce((sum, entry) => sum + entry.megabytes, 0);
}

function summary(processes: readonly Process[]) {
  const kinds = [...new Set(processes.map((entry) => entry.kind))];

  return {
    total: total(processes),
    byKind: Object.fromEntries(
      kinds.map((kind) => [kind, total(processes.filter((entry) => entry.kind === kind))]),
    ),
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

function hugeGo(lines: number): string {
  const unit = (index: number) => [
    `// Record${String(index)} is one row of the generated table.`,
    `type Record${String(index)} struct {`,
    "\tID      int64",
    "\tName    string",
    "\tTags    []string",
    "\tUpdated time.Time",
    "}",
    "",
    `func (r *Record${String(index)}) Valid() error {`,
    '\tif r.Name == "" {',
    `\t\treturn fmt.Errorf("record %d: empty name", r.ID)`,
    "\t}",
    "\tfor _, tag := range r.Tags {",
    "\t\tif strings.TrimSpace(tag) != tag {",
    '\t\t\treturn fmt.Errorf("record %d: tag %q has spaces", r.ID, tag)',
    "\t\t}",
    "\t}",
    "\treturn nil",
    "}",
    "",
  ];

  const head = ["package huge", "", "import (", '\t"fmt"', '\t"strings"', '\t"time"', ")", ""];

  const body = Array.from({ length: Math.ceil(lines / unit(0).length) }, (_, index) =>
    unit(index),
  ).flat();

  return [...head, ...body].slice(0, lines).join("\n");
}

function heavyDesign(frames: number): string {
  const screens = Array.from({ length: frames }, (_, index) =>
    [
      `      <div data-frame="Heavy ${String(index)}" data-x="${String((index % 20) * 450)}" data-y="${String(1_000 + Math.floor(index / 20) * 920)}" className="tonight">`,
      '        <div className="tonight-column">',
      "          <PhaseCard />",
      '          <div className="row wide">',
      "            <Stat />",
      '            <Stat label="Moonset" value="06:15" icon="sunset.fill" />',
      "          </div>",
      '          <div className="row">',
      "            <Chip />",
      '            <Chip label="Clear sky" icon="sparkles" />',
      '            <Chip label="High tide" icon="water.waves" />',
      "          </div>",
      '          <Button label="Wake me at moonset" />',
      "        </div>",
      "      </div>",
    ].join("\n"),
  );

  return [
    'import "../tokens.css";',
    'import "./tonight.css";',
    'import { Button, Chip, Stat } from "../controls.jsx";',
    'import { PhaseCard } from "../blocks/phase-card.jsx";',
    "",
    "export default function Heavy() {",
    "  return (",
    "    <>",
    ...screens,
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n");
}
