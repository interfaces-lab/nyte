import { _electron, expect } from "@playwright/test";
import type { CDPSession, ElectronApplication, Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { dev } from "@nyte-ai/core";
import { lastUserText, titleReply } from "@nyte-ai/host/bench";
import type { Reply } from "@nyte-ai/host/bench";
import { sdk } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { e2eModels, scriptedReply } from "../src/main/fixtures/e2e-models.ts";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { keystrokeMeasure, typeAndMeasure } from "./keystrokes.ts";
import { polishModel, serveScriptedModel } from "./polish-fixture.ts";
import { inspectProcessTree } from "./process-tree.ts";
import {
  chatRow,
  clearComposer,
  leaveSettings,
  messages,
  openNewChat,
  send,
  sidebar,
} from "./ui.ts";

const timeout = 60_000;

const MIB = 1_024 * 1_024;

/** The streamed answer: 300 deltas, one every 16 ms (about 60 tokens a second for 5 s). */
const streamDeltas = 300;

const streamEnd = "Stream end marker.";

/**
 * Every metric this bench reports, with the judged build's ceiling (`max`) or floor (`min`), or
 * `null` to report only. Latency ceilings are main c7094f5c's medians on the same machine where
 * main sets the bar; the rest are absolute (one 60 Hz frame, no idle CPU, no leak).
 */
const metricFields = [
  { key: "openTranscriptMs", label: "Open the 2,000-message chat", unit: "ms", max: null },
  { key: "keystrokeMs", label: "Keystroke to paint, in that chat", unit: "ms", max: 16.7 },
  { key: "keystrokeWaitingMs", label: "  with vsync wait", unit: "ms", max: null },
  { key: "streamFrameP95Ms", label: "Frame time p95, streaming", unit: "ms", max: 16.7 * 1.5 },
  { key: "streamFrameMaxMs", label: "Longest frame, streaming", unit: "ms", max: null },
  { key: "streamLongFrames", label: "Long animation frames, streaming", unit: "count", max: 0 },
  { key: "scrollFps", label: "Scroll FPS", unit: "fps", min: 55 },
  { key: "scrollFrameP95Ms", label: "Frame time p95, scrolling", unit: "ms", max: 16.7 * 1.5 },
  { key: "browserColdMs", label: "Browser panel, cold", unit: "ms", max: null },
  { key: "browserWarmMs", label: "Browser panel, warm", unit: "ms", max: null },
  { key: "terminalColdMs", label: "Terminal panel, cold", unit: "ms", max: null },
  { key: "terminalWarmMs", label: "Terminal panel, warm", unit: "ms", max: null },
  { key: "filesColdMs", label: "Files panel, cold", unit: "ms", max: null },
  { key: "filesWarmMs", label: "Files panel, warm", unit: "ms", max: null },
  { key: "changesColdMs", label: "Changes panel, cold", unit: "ms", max: null },
  { key: "changesWarmMs", label: "Changes panel, warm", unit: "ms", max: null },
  { key: "idleCpuPercent", label: "Idle CPU, all processes", unit: "%", max: 0.5 },
  { key: "idleWakeups", label: "Idle wakeups/s, all processes", unit: "count", max: null },
  { key: "switchMs", label: "Session switch", unit: "ms", max: null },
  { key: "transcriptSwitchMs", label: "Switch to the 2,000-message chat", unit: "ms", max: null },
  {
    key: "switchHeapGrowth",
    label: "Renderer heap growth, 50 switches",
    unit: "bytes",
    max: 4 * MIB,
  },
  { key: "switchNodeGrowth", label: "DOM node growth, 50 switches", unit: "count", max: 2_000 },
  { key: "switchProcessGrowth", label: "Process growth, 50 switches", unit: "count", max: 0 },
  { key: "soakStalls", label: "Soak turns that stalled", unit: "count", max: 0 },
  { key: "soakHeapSlope", label: "Renderer heap per soak turn", unit: "bytes", max: 64 * 1_024 },
  { key: "soakHeapGrowth", label: "Renderer heap growth, soak", unit: "bytes", max: null },
  { key: "soakRssGrowth", label: "RSS growth, soak", unit: "bytes", max: null },
] as const;

type MetricKey = (typeof metricFields)[number]["key"];

const SeededSchema = Type.Object({
  directory: Type.String(),
  home: Type.String(),
  profile: Type.String(),
  transcript: Type.Object({
    title: Type.String(),
    lastMessage: Type.String(),
    turns: Type.Number(),
  }),
  others: Type.Array(Type.String()),
});

type Fixture = Type.Static<typeof SeededSchema>;

interface Build {
  readonly name: "baseline" | "candidate";
  readonly executable: string;
}

/** Paths resolve against INIT_CWD, where pnpm was invoked, because `pnpm --dir` moves the cwd. */
function readOptions() {
  const { values } = parseArgs({
    options: {
      exe: { type: "string" },
      compare: { type: "string" },
      "baseline-seed": { type: "string" },
      out: { type: "string" },
      turns: { type: "string", default: "1000" },
      switches: { type: "string", default: "50" },
      "idle-seconds": { type: "string", default: "60" },
      "soak-turns": { type: "string", default: "60" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(
      "Usage: pnpm --dir packages/desktop bench:interaction --exe <packaged executable> [--compare <executable>]\n" +
        "  --baseline-seed <script>  --turns 1000  --switches 50  --idle-seconds 60  --soak-turns 60  --out <report.json>\n",
    );

    return undefined;
  }

  if (!values.exe) throw new Error("--exe must name a packaged Nyte executable.");
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const builds: Build[] = [{ name: "baseline", executable: resolve(invokedFrom, values.exe) }];

  if (values.compare)
    builds.push({ name: "candidate", executable: resolve(invokedFrom, values.compare) });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

  return {
    builds,
    baselineSeed:
      values["baseline-seed"] === undefined
        ? undefined
        : resolve(invokedFrom, values["baseline-seed"]),
    output:
      values.out === undefined
        ? join(import.meta.dirname, "test-results", `interaction-${stamp}.json`)
        : resolve(invokedFrom, values.out),
    turns: Number(values.turns),
    switches: Number(values.switches),
    idleSeconds: Number(values["idle-seconds"]),
    soakTurns: Number(values["soak-turns"]),
  };
}

type Options = NonNullable<ReturnType<typeof readOptions>>;

/** The baseline chats plus one of `turns` echoed turns, seeded through this revision's SDK. */
async function seedHome(directory: string, turns: number): Promise<Fixture> {
  dev.off();
  const prepared = await prepareHome(directory);

  const host = await sdk.open({
    home: prepared.home,
    workspace: { kind: "local", path: prepared.home },
    models: e2eModels().models,
  });

  const title = `Transcript ${turns * 2}`;

  try {
    const session = await host.sessions.create({ name: title });

    for (let turn = 1; turn <= turns; turn++) {
      const outcome = await (await session.send(`Turn ${turn} of ${turns}`)).settled();

      if (outcome.kind !== "completed")
        throw new Error(`Seeding turn ${turn} failed: ${outcome.kind}`);
    }
  } finally {
    await host.close();
  }

  const profile = join(directory, "profile");
  await mkdir(profile, { recursive: true, mode: 0o700 });

  return {
    directory,
    home: prepared.home,
    profile,
    transcript: { title, lastMessage: `Echo: Turn ${turns} of ${turns}`, turns },
    others: Object.values(FIXTURES),
  };
}

/** Lists the scripted model as Anthropic's only model and stores a key for it, in every build's format. */
async function allowScriptedModel(home: string, origin: string): Promise<void> {
  await mkdir(join(home, ".nyte"), { recursive: true });
  await writeFile(
    join(home, ".nyte", "auth.json"),
    JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api03-bench" } }),
    { mode: 0o600 },
  );
  await writeFile(
    join(home, ".nyte", "models-store.json"),
    JSON.stringify({
      rawCatalogs: { anthropic: { checkedAt: Date.now(), models: [polishModel(origin)] } },
    }),
  );
}

async function prepare(build: Build, options: Options, directory: string): Promise<Fixture> {
  if (build.name !== "baseline" || options.baselineSeed === undefined)
    return seedHome(directory, options.turns);

  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--conditions=nyte-source",
      options.baselineSeed,
      directory,
      "transcript",
      String(options.turns),
    ],
    { cwd: dirname(options.baselineSeed), maxBuffer: MIB },
  );

  return Value.Parse(SeededSchema, JSON.parse(stdout));
}

async function launch(build: Build, fixture: Fixture, origin: string) {
  const kept = ["PATH", "SHELL", "USER", "LOGNAME", "TMPDIR", "LANG", "TERM"].flatMap((name) => {
    const value = process.env[name];

    return value === undefined ? [] : [[name, value]];
  });

  return _electron.launch({
    executablePath: build.executable,
    args: [`--user-data-dir=${fixture.profile}`, "--use-mock-keychain", "--password-store=basic"],
    cwd: dirname(build.executable),
    env: {
      ...Object.fromEntries(kept),
      HOME: fixture.home,
      CFFIXED_USER_HOME: fixture.home,
      NYTE_OFFLINE: "1",
      NYTE_MODELS_URL: `${origin}/catalog`,
    },
    timeout,
  });
}

/** Resolves with the renderer time of the first frame showing `title`'s tab selected over `lastMessage`. */
async function chatShown(page: Page, scenario: { title: string; lastMessage: string }) {
  const handle = await page.waitForFunction(
    ({ title, lastMessage }) => {
      const tab = document.querySelector(
        '[role="tablist"][aria-label="Tabs"] [role="tab"][aria-selected="true"]',
      );

      const shown =
        [tab?.getAttribute("aria-label"), tab?.textContent].some((name) => name?.includes(title)) &&
        document.querySelector('[aria-label="Messages"]')?.textContent?.includes(lastMessage) ===
          true &&
        (document.querySelector('[aria-label="Messages"]')?.textContent?.length ?? 0) > 0;

      return shown ? performance.now() : false;
    },
    scenario,
    { polling: "raf", timeout },
  );

  return Value.Parse(Type.Number(), await handle.jsonValue());
}

/** Resolves with the renderer time of the first frame where the workbench shows `selector`. */
async function workbenchShows(page: Page, selector: string) {
  const handle = await page.waitForFunction(
    (inner) => {
      const element = document.querySelector(`[aria-label="Workbench"] ${inner}`);

      return element instanceof HTMLElement && element.checkVisibility()
        ? performance.now()
        : false;
    },
    selector,
    { polling: "raf", timeout },
  );

  return Value.Parse(Type.Number(), await handle.jsonValue());
}

/** The renderer time of the next pointerdown, armed before a click. */
async function armPointer(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.addEventListener(
      "pointerdown",
      (event) => performance.mark("nyte-bench:pointer", { startTime: event.timeStamp }),
      { capture: true, once: true },
    ),
  );
}

async function pointerTime(page: Page): Promise<number> {
  return Value.Parse(
    Type.Number(),
    await page.evaluate(() => {
      const mark = performance.getEntriesByName("nyte-bench:pointer").at(-1)?.startTime;
      performance.clearMarks("nyte-bench:pointer");

      return mark ?? Number.NaN;
    }),
  );
}

/** Shows `title`'s sidebar row, which moves under the Done shelf once its chat has been read. */
async function revealRow(page: Page, title: string): Promise<void> {
  const row = chatRow(page, title);

  if (await row.isVisible()) return;
  const done = sidebar(page).getByRole("button", { name: /^Done ?\d+$/u });

  if ((await done.getAttribute("aria-expanded")) !== "true") await done.click();
  const more = sidebar(page).getByRole("button", { name: /^Show \d+ More$/iu });

  if (!(await row.isVisible()) && (await more.isVisible())) await more.click();
  await row.waitFor();
}

/** Opens a chat from the sidebar and returns pointerdown to the first frame showing its last message. */
async function switchTo(page: Page, title: string, lastMessage: string): Promise<number> {
  await revealRow(page, title);
  await armPointer(page);
  const shown = chatShown(page, { title, lastMessage });
  shown.catch(() => undefined);
  await chatRow(page, title).click();
  const end = await shown;

  return end - (await pointerTime(page));
}

/** Records every animation frame's timestamp until stopped; returns the frame intervals in ms. */
async function recordFrames(page: Page): Promise<() => Promise<readonly number[]>> {
  await page.evaluate(() => {
    document.documentElement.dataset.benchFrames = "on";
    performance.clearMarks("nyte-bench:frame");

    const tick = (time: number): void => {
      if (document.documentElement.dataset.benchFrames !== "on") return;
      performance.mark("nyte-bench:frame", { startTime: time });
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });

  return async () => {
    const times = await page.evaluate(() => {
      document.documentElement.dataset.benchFrames = "off";

      return performance.getEntriesByName("nyte-bench:frame").map((entry) => entry.startTime);
    });

    return times.slice(1).map((time, index) => time - (times[index] ?? time));
  };
}

async function longAnimationFrames(page: Page, sinceMs: number): Promise<number> {
  return page.evaluate(
    (since) =>
      new Promise<number>((done) => {
        if (!PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) done(-1);

        const observer = new PerformanceObserver((list) => {
          observer.disconnect();
          done(list.getEntries().filter((entry) => entry.startTime >= since).length);
        });

        observer.observe({ type: "long-animation-frame", buffered: true });
        setTimeout(() => done(0), 250);
      }),
    sinceMs,
  );
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);

  return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? Number.NaN;
}

/**
 * Adds the Anthropic API key in Settings, as a user does, so the build refreshes Anthropic's
 * catalog from the scripted endpoint: this branch keeps keys in the keychain, not auth.json.
 */
async function connectAnthropic(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("link", { name: "Providers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
  const offer = page.getByText("Claude models from Anthropic");
  await offer
    .or(page.getByText("Anthropic", { exact: true }))
    .first()
    .waitFor();

  if (await offer.isVisible()) {
    await offer.locator("xpath=ancestor::*[.//button][1]").getByRole("button").first().click();
    await page.getByRole("menuitem", { name: /API Key/u }).click();
    await page.getByPlaceholder(/API key/iu).fill("sk-ant-api03-bench");
    await page.keyboard.press("Enter");
    await expect(offer).toBeHidden({ timeout });
  }

  await leaveSettings(page);
}

/** Picks the scripted model in the open chat's composer, through the picker's Model submenu where it has one. */
async function chooseScripted(page: Page): Promise<void> {
  const picker = page.getByRole("form", { name: "Message composer" }).getByRole("button", {
    name: /Scripted|Choose a model|model/iu,
  });

  if ((await picker.first().textContent())?.includes("Scripted")) return;
  await picker.first().click();
  const scripted = page.getByRole("option", { name: /^Scripted/u });
  const submenu = page.getByRole("menuitem", { name: /^Model/u });

  await scripted.or(submenu).first().waitFor();

  if (!(await scripted.isVisible())) await submenu.hover();
  await scripted.click();
  await page.keyboard.press("Escape");
  await expect(picker.first()).toContainText("Scripted");
}

async function heap(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage");
  const counters = await cdp.send("Memory.getDOMCounters");

  return { heap: usage.usedSize, nodes: counters.nodes, listeners: counters.jsEventListeners };
}

async function treeTotals(application: ElectronApplication) {
  const tree = (await inspectProcessTree(application.process().pid)) ?? [];

  return { processes: tree.length, rss: tree.reduce((total, row) => total + row.residentBytes, 0) };
}

/** Electron's CPU and idle wakeups per process, averaged since the previous call. */
async function appMetrics(application: ElectronApplication) {
  return application.evaluate(({ app }) =>
    app.getAppMetrics().map((entry) => ({
      type: entry.type,
      name: entry.name,
      wakeups: entry.cpu.idleWakeupsPerSecond,
      cpu: entry.cpu.percentCPUUsage,
    })),
  );
}

/** CPU seconds per process of the tree from `ps`, whose `time` reads [[hh:]mm:]ss.cc. */
async function cpuSeconds(
  root: number | undefined,
): Promise<ReadonlyMap<number, { command: string; seconds: number }>> {
  const tree = new Set((await inspectProcessTree(root))?.map((row) => row.pid) ?? []);
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,time=,comm="]);

  return new Map(
    stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+([\d:.]+)\s+(.*)$/u.exec(line);

      if (match === null || !tree.has(Number(match[1]))) return [];

      const seconds = (match[2] ?? "0")
        .split(":")
        .reduce((total, part) => total * 60 + Number(part), 0);

      return [[Number(match[1]), { command: match[3] ?? "", seconds }]];
    }),
  );
}

const panels = [
  { key: "browser", rail: "Browser", ready: '[aria-label="Address"]' },
  { key: "terminal", rail: "Terminal", ready: '[aria-label="Terminal input"]' },
  { key: "files", rail: "Files", ready: '[aria-label="Go to file"]' },
  { key: "changes", rail: "Changes", ready: '[aria-label="Workspace changes"]' },
] as const;

/** Opens a workbench panel from its rail button: pointerdown to the first frame its content shows. */
async function openPanel(page: Page, rail: string, ready: string): Promise<number> {
  const workbench = page.getByRole("complementary", { name: "Workbench" });
  await armPointer(page);
  const shown = workbenchShows(page, ready);
  shown.catch(() => undefined);

  await workbench
    .getByRole("navigation", { name: "Workbench navigation" })
    .getByRole("button", { name: rail })
    .click();
  const end = await shown;

  return end - (await pointerTime(page));
}

async function closeWorkbenchTabs(page: Page): Promise<void> {
  const tabs = page.getByRole("tablist", { name: "Workbench tabs" });

  for (let left = await tabs.getByRole("tab").count(); left > 0; left--) {
    const tab = tabs.getByRole("tab").first();
    const label = await tab.getAttribute("aria-label");
    await tab.hover({ position: { x: 8, y: 8 } });
    await tabs.getByRole("button", { name: `Close ${label ?? ""} tab` }).click();
    const confirm = page.getByRole("alertdialog").getByRole("button", { name: /^Close/u });

    await confirm.click({ timeout: 2_000 }).catch(() => undefined);
  }

  await expect(tabs.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workbench navigation" })).toBeVisible();
}

/** Runs one measuring step, keeping its error instead of ending the run. */
async function step(
  page: Page,
  errors: string[],
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  process.stderr.write(`  ${name}\n`);

  try {
    await run();
  } catch (cause) {
    const message = `${name}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`;
    process.stderr.write(`    failed: ${message}\n`);
    errors.push(message);

    if (process.env.NYTE_BENCH_DEBUG !== undefined) {
      await page.screenshot({ path: join(process.env.NYTE_BENCH_DEBUG, `${name}.png`) });
      await writeFile(
        join(process.env.NYTE_BENCH_DEBUG, `${name}.yml`),
        await page.locator("body").ariaSnapshot(),
      );
    }

    await page.keyboard.press("Escape");
  }
}

async function measure(
  build: Build,
  options: Options,
  model: Awaited<ReturnType<typeof serveScripted>>,
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "nyte-interaction-")));
  const metrics: Record<string, number[]> = {};
  const errors: string[] = [];
  const notes: Record<string, unknown> = {};

  const add = (key: MetricKey, ...values: readonly number[]): void => {
    metrics[key] = [...(metrics[key] ?? []), ...values];
  };

  try {
    const fixture = await prepare(build, options, directory);
    await allowScriptedModel(fixture.home, model.origin);
    const application = await launch(build, fixture, model.origin);

    try {
      const page = await application.firstWindow({ timeout });
      await page.bringToFront();
      await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout });
      const cdp = await application.context().newCDPSession(page);
      let { transcript } = fixture;

      await step(page, errors, "connect Anthropic", () => connectAnthropic(page));

      await step(page, errors, "open the transcript", async () => {
        const first = fixture.others.at(-1) ?? transcript.title;
        await switchTo(page, first, "");
        add("openTranscriptMs", await switchTo(page, transcript.title, transcript.lastMessage));
      });

      await step(page, errors, "keystrokes", async () => {
        await typeAndMeasure(page);

        const keys = await page.evaluate((name) => {
          const entries = performance
            .getEntriesByName(name)
            .flatMap((entry) => (entry instanceof PerformanceMeasure ? [entry] : []));

          performance.clearMeasures(name);

          return entries.map((entry) => ({ duration: entry.duration, work: entry.detail }));
        }, keystrokeMeasure);

        add(
          "keystrokeMs",
          ...keys.map(({ work, duration }) => (Value.Check(Type.Number(), work) ? work : duration)),
        );
        add("keystrokeWaitingMs", ...keys.map(({ duration }) => duration));
        await clearComposer(page);
      });

      await step(page, errors, "stream into the transcript", async () => {
        await chooseScripted(page);
        const streamed = model.nextStream();
        const stop = await recordFrames(page);
        const since = Value.Parse(Type.Number(), await page.evaluate(() => performance.now()));
        await send(page, "/bench-stream");
        const window = await streamed;
        await page.waitForTimeout(300);
        const intervals = await stop();

        const origin = Value.Parse(
          Type.Number(),
          await page.evaluate(() => performance.timeOrigin),
        );

        notes.streamWindowMs = window.lastEpochMs - window.firstEpochMs;
        notes.streamFrames = intervals.length;
        notes.streamOrigin = origin;
        add("streamFrameP95Ms", percentile(intervals, 0.95));
        add("streamFrameMaxMs", Math.max(...intervals));
        add("streamLongFrames", await longAnimationFrames(page, since));
        await expect(messages(page)).toContainText(streamEnd, { timeout });
        transcript = { ...transcript, lastMessage: streamEnd };
      });

      await step(page, errors, "scroll the transcript", async () => {
        const region = messages(page);
        await region.hover();

        const scrollTop = () =>
          page.evaluate(() => {
            let node = document.querySelector('[aria-label="Messages"]');

            while (node !== null && node.scrollHeight <= node.clientHeight)
              node = node.parentElement;

            return node?.scrollTop ?? Number.NaN;
          });

        const top = await scrollTop();
        const before = await page.evaluate(() => performance.now());
        const stop = await recordFrames(page);

        for (let wheel = 0; wheel < 90; wheel++) {
          await page.mouse.wheel(0, -240);
          await page.waitForTimeout(16);
        }

        const intervals = await stop();
        const elapsed = intervals.reduce((total, interval) => total + interval, 0);
        notes.scrollFrames = intervals.length;
        notes.scrolledPx = top - (await scrollTop());
        notes.scrollWallMs = (await page.evaluate(() => performance.now())) - before;
        add("scrollFps", (intervals.length / elapsed) * 1_000);
        add("scrollFrameP95Ms", percentile(intervals, 0.95));
        await page.keyboard.press("End").catch(() => undefined);
      });

      for (const panel of panels)
        await step(page, errors, `${panel.rail} panel`, async () => {
          for (const phase of ["Cold", "Warm"] as const) {
            add(`${panel.key}${phase}Ms`, await openPanel(page, panel.rail, panel.ready));
            await closeWorkbenchTabs(page);
          }
        });

      await step(page, errors, "idle", async () => {
        await page.waitForTimeout(5_000);
        const pid = application.process().pid;
        await appMetrics(application);
        const before = await cpuSeconds(pid);
        const started = performance.now();
        await page.waitForTimeout(options.idleSeconds * 1_000);
        const after = await cpuSeconds(pid);
        const wall = (performance.now() - started) / 1_000;

        const perProcess = [...after].map(([processId, row]) => ({
          pid: processId,
          command: row.command,
          cpuPercent: ((row.seconds - (before.get(processId)?.seconds ?? 0)) / wall) * 100,
        }));

        const wakeups = await appMetrics(application);

        notes.idle = { perProcess, wakeups, wallSeconds: wall };
        add(
          "idleCpuPercent",
          perProcess.reduce((total, row) => total + row.cpuPercent, 0),
        );
        add(
          "idleWakeups",
          wakeups.reduce((total, row) => total + row.wakeups, 0),
        );
      });

      await step(page, errors, `${options.switches} session switches`, async () => {
        const targets = [...fixture.others.slice(0, 4), transcript.title];
        notes.switchTargets = targets;
        const warm = { ...(await heap(cdp)), ...(await treeTotals(application)) };

        for (let index = 0; index < options.switches; index++) {
          const title = targets[index % targets.length] ?? transcript.title;
          const elapsed = await switchTo(page, title, "");
          add(title === transcript.title ? "transcriptSwitchMs" : "switchMs", elapsed);
        }

        const settled = { ...(await heap(cdp)), ...(await treeTotals(application)) };
        notes.switches = { warm, settled };
        add("switchHeapGrowth", settled.heap - warm.heap);
        add("switchNodeGrowth", settled.nodes - warm.nodes);
        add("switchProcessGrowth", settled.processes - warm.processes);
      });

      await step(page, errors, `soak of ${options.soakTurns} turns`, async () => {
        await openNewChat(page);
        await chooseScripted(page);
        const samples: { turn: number; heap: number; nodes: number; rss: number }[] = [];

        const stalled: number[] = [];

        for (let turn = 1; turn <= options.soakTurns; turn++) {
          await send(page, `/soak ${turn}`);
          const answered = await expect(messages(page))
            .toContainText(`Soak answer ${turn}.`, { timeout: 20_000 })
            .then(
              () => true,
              () => false,
            );

          if (!answered) {
            stalled.push(turn);
            await page.getByRole("button", { name: "Stop response" }).click();
            await expect(page.getByRole("button", { name: "Stop response" })).toBeHidden();
          }

          if (turn % 10 === 0 || turn === 1) {
            const sample = await heap(cdp);
            samples.push({
              turn,
              heap: sample.heap,
              nodes: sample.nodes,
              rss: (await treeTotals(application)).rss,
            });
          }
        }

        notes.soak = { samples, stalled };
        add("soakStalls", stalled.length);
        const first = samples.find((sample) => sample.turn === 10) ?? samples[0];
        const last = samples.at(-1);

        if (first !== undefined && last !== undefined && last.turn > first.turn) {
          add("soakHeapSlope", (last.heap - first.heap) / (last.turn - first.turn));
          add("soakHeapGrowth", last.heap - first.heap);
          add("soakRssGrowth", last.rss - first.rss);
        }
      });

      await cdp.detach().catch(() => undefined);
    } finally {
      const tree = await inspectProcessTree(application.process().pid);
      await application.close().catch(() => undefined);

      for (const row of tree ?? [])
        try {
          process.kill(row.pid, "SIGKILL");
        } catch {
          continue;
        }
    }

    notes.fixture = { transcriptTurns: fixture.transcript.turns, others: fixture.others.length };
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  return { build, metrics, errors, notes };
}

/** The scripted model, with `/bench-stream` and `/soak` answers and a promise for each stream's deltas. */
async function serveScripted() {
  let waiting: ((window: { firstEpochMs: number; lastEpochMs: number }) => void) | undefined;
  let firstEpochMs = 0;

  const paragraphs = Array.from(
    { length: 60 },
    (_, index) =>
      `Streamed paragraph ${index + 1}: the quick brown fox jumps over the lazy dog while the answer keeps arriving.`,
  ).join("\n\n");

  const answer = (request: Parameters<Parameters<typeof serveScriptedModel>[0]>[0]): Reply => {
    const title = titleReply(request);
    const text = lastUserText(request);
    let deltas = 0;

    if (process.env.NYTE_BENCH_DEBUG !== undefined) {
      process.stderr.write(
        `    model request: ${title === null ? text.slice(0, 40) : "(title)"}\n`,
      );
      request.options?.signal?.addEventListener("abort", () =>
        process.stderr.write(`    model aborted: ${text.slice(0, 40)} after ${deltas} deltas\n`),
      );
    }

    if (title !== null) return { content: [{ type: "text", text: title }] };

    if (text === "/bench-stream")
      return {
        content: [{ type: "text", text: `${paragraphs}\n\n${streamEnd}` }],
        tokens: streamDeltas,
        timing: { deltaMs: 16 },
        tap: (streamed) => {
          if (streamed === 1) firstEpochMs = Date.now();

          if (streamed === streamDeltas) waiting?.({ firstEpochMs, lastEpochMs: Date.now() });
        },
      };
    const soak = /^\/soak (\d+)$/u.exec(text);

    if (soak !== null)
      return {
        content: [{ type: "text", text: `${paragraphs.slice(0, 600)}\n\nSoak answer ${soak[1]}.` }],
        tokens: 40,
        timing: { deltaMs: 10 },
        tap: (streamed) => {
          deltas = streamed;

          if (process.env.NYTE_BENCH_DEBUG !== undefined && streamed === 40)
            process.stderr.write(`    model streamed: ${text}\n`);
        },
      };

    return scriptedReply(text);
  };

  const endpoint = await serveScriptedModel(answer);

  return {
    origin: endpoint.origin,
    close: () => endpoint.close(),
    nextStream: () =>
      new Promise<{ firstEpochMs: number; lastEpochMs: number }>((done) => (waiting = done)),
  };
}

function summarize(runs: readonly Awaited<ReturnType<typeof measure>>[]) {
  const judged = runs.at(-1)?.build.name;

  return runs.map((run) => ({
    build: run.build.name,
    metrics: metricFields.map((field) => {
      const values = run.metrics[field.key] ?? [];
      const median = values.length === 0 ? null : percentile(values, 0.5);
      const p95 = values.length === 0 ? null : percentile(values, 0.95);
      const ceiling = "max" in field ? field.max : null;
      const floor = "min" in field ? field.min : null;

      const over =
        run.build.name === judged &&
        ((ceiling !== null && (p95 === null || p95 > ceiling)) ||
          (floor !== null && (median === null || median < floor)));

      return {
        key: field.key,
        label: field.label,
        unit: field.unit,
        count: values.length,
        median,
        p95,
        ceiling,
        floor,
        over,
      };
    }),
  }));
}

async function run(options: Options): Promise<void> {
  for (const build of options.builds) await access(build.executable);
  const model = await serveScripted();
  const runs = [];

  try {
    for (const build of options.builds) {
      process.stderr.write(`${build.name}: ${build.executable}\n`);
      runs.push(await measure(build, options, model));
    }
  } finally {
    await model.close();
  }

  const summaries = summarize(runs);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(
    options.output,
    JSON.stringify(
      { version: 1, recordedAt: new Date().toISOString(), options, runs, summaries },
      null,
      2,
    ) + "\n",
  );

  for (const summary of summaries) {
    process.stdout.write(`\n${summary.build}\n`);

    for (const metric of summary.metrics) {
      const shown = (value: number | null): string => {
        if (value === null) return "-";

        return metric.unit === "bytes"
          ? `${(value / MIB).toFixed(2)}M`
          : value.toFixed(metric.unit === "count" ? 0 : 1);
      };

      const limit =
        metric.ceiling === null
          ? metric.floor === null
            ? ""
            : `>= ${shown(metric.floor)}`
          : `<= ${shown(metric.ceiling)}`;

      process.stdout.write(
        `  ${metric.label.padEnd(38)} ${shown(metric.median).padStart(9)} ${shown(metric.p95).padStart(9)}  n=${String(metric.count).padEnd(4)} ${limit}${metric.over ? " OVER" : ""}\n`,
      );
    }
  }

  for (const result of runs)
    for (const error of result.errors) process.stderr.write(`${result.build.name}: ${error}\n`);

  const over = summaries.flatMap((summary) =>
    summary.metrics.filter((metric) => metric.over).map((metric) => metric.key),
  );

  if (over.length > 0) process.stderr.write(`Over budget: ${over.join(", ")}\n`);
  process.stdout.write(`Raw report: ${options.output}\n`);

  if (over.length > 0 || runs.some((result) => result.errors.length > 0)) process.exitCode = 1;
}

try {
  const options = readOptions();

  if (options !== undefined) await run(options);
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
}
