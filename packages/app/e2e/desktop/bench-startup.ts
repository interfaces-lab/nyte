import { _electron, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { prepareStartupFixture, startupCases } from "./startup-fixture.ts";
import type { StartupCase, StartupFixture } from "./startup-fixture.ts";
import { chatTab, clearComposer, composer, messages, openChat } from "./ui.ts";
import { CALL_CHANNEL } from "../../../desktop/src/shared/ipc.ts";

const timeout = 30_000;

const MIB = 1_024 * 1_024;

const typedText = "startup benchmark keystrokes";

const keystrokeDelayMs = 40;

const keystrokeMeasure = "nyte-bench:keystroke";

function every(limit: number): Readonly<Record<StartupCase, number>> {
  return { fresh: limit, restored: limit, heavy: limit };
}

/**
 * Every metric the bench reports. `budget` is the p95 ceiling the judged build must stay under,
 * by scenario; `null` reports without gating. Latency, splash, long-task, and fresh heap and
 * memory budgets hold the line at main 0.0.18 (macOS arm64, packaged, 7 runs); IPC, host
 * requests, and restored or heavy heap and memory ratchet at this branch until they shrink.
 */
const metricFields = [
  {
    key: "spawnToTypedInputMs",
    label: "Spawn to typed input",
    unit: "ms",
    budget: { fresh: 1_000, restored: 1_100, heavy: 1_250 },
  },
  {
    key: "spawnToComposerMs",
    label: "Spawn to composer",
    unit: "ms",
    budget: { fresh: 950, restored: 1_000, heavy: 1_150 },
  },
  {
    key: "spawnToFirstPaintMs",
    label: "Spawn to first paint (FCP)",
    unit: "ms",
    budget: every(550),
  },
  {
    key: "splashMs",
    label: "Splash visible",
    unit: "ms",
    budget: { fresh: 450, restored: 500, heavy: 600 },
  },
  { key: "keystrokeToPaintMs", label: "Keystroke to paint", unit: "ms", budget: every(16.7) },
  { key: "longTasks", label: "Long tasks before composer", unit: "count", budget: every(2) },
  { key: "longTaskMs", label: "Long-task time before composer", unit: "ms", budget: every(150) },
  { key: "longestTaskMs", label: "Longest task before composer", unit: "ms", budget: every(100) },
  {
    key: "ipcCalls",
    label: "IPC round trips before composer",
    unit: "count",
    budget: { fresh: 3, restored: 4, heavy: 4 },
  },
  {
    key: "hostRequests",
    label: "Host requests before composer",
    unit: "count",
    budget: { fresh: 10, restored: 13, heavy: 13 },
  },
  { key: "mainHeapBytes", label: "Main JS heap", unit: "bytes", budget: every(40 * MIB) },
  {
    key: "rendererHeapBytes",
    label: "Renderer JS heap",
    unit: "bytes",
    budget: { fresh: 24 * MIB, restored: 40 * MIB, heavy: 48 * MIB },
  },
  { key: "processes", label: "Processes", unit: "count", budget: every(4) },
  {
    key: "residentBytes",
    label: "Resident memory, all processes",
    unit: "bytes",
    budget: { fresh: 720 * MIB, restored: 800 * MIB, heavy: 820 * MIB },
  },
  { key: "mainToWindowMs", label: "Main: entry to window shown", unit: "ms", budget: null },
  { key: "hostOpenMs", label: "Main: host opening", unit: "ms", budget: null },
  { key: "listenerMs", label: "Main: listener binding", unit: "ms", budget: null },
  { key: "sdkConnectMs", label: "Renderer: SDK connection", unit: "ms", budget: null },
  { key: "dataLoadMs", label: "Renderer: initial data", unit: "ms", budget: null },
  { key: "routeMs", label: "Renderer: initial route", unit: "ms", budget: null },
] as const;

type MetricKey = (typeof metricFields)[number]["key"];

type Metrics = Readonly<Record<MetricKey, readonly number[]>>;

const ReadySchema = Type.Object({ readyMs: Type.Number() });

interface Build {
  readonly name: "baseline" | "candidate";
  readonly executable: string;
}

interface Options {
  readonly builds: readonly Build[];
  readonly scenarios: readonly StartupCase[];
  readonly runs: number;
  readonly warmup: number;
  readonly output: string;
  readonly json: boolean;
}

interface Identity {
  readonly build: Build;
  readonly scenario: StartupCase;
  readonly repetition: number;
  readonly warmup: boolean;
}

type Sample =
  | {
      readonly kind: "complete";
      readonly identity: Identity;
      readonly fixture: Pick<StartupFixture, "sessions" | "turns" | "storeBytes">;
      readonly metrics: Metrics;
      readonly main: Awaited<ReturnType<typeof inspectMain>>;
      readonly renderer: Awaited<ReturnType<typeof inspectRenderer>>;
      readonly processTree: Awaited<ReturnType<typeof inspectProcessTree>>;
      readonly errors: readonly string[];
      readonly output: readonly string[];
    }
  | {
      readonly kind: "failed";
      readonly identity: Identity;
      readonly error: string;
      readonly output: readonly string[];
    };

/** Paths resolve against INIT_CWD, where pnpm was invoked, because `pnpm --dir` moves the cwd. */
function readOptions(): Options | undefined {
  const { values } = parseArgs({
    options: {
      exe: { type: "string" },
      compare: { type: "string" },
      scenario: { type: "string", default: "all" },
      runs: { type: "string", default: "5" },
      warmup: { type: "string", default: "1" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(
      "Usage: pnpm bench:desktop --exe <packaged executable> [--compare <executable>]\n" +
        "  --scenario all|fresh|restored|heavy  --runs 5  --warmup 1  --out <report.json>  --json\n" +
        "On macOS, pass Nyte.app/Contents/MacOS/Nyte. No build or dev server is started.\n" +
        "Budgets gate the last build: --compare when given, otherwise --exe.\n",
    );

    return undefined;
  }

  if (!values.exe) throw new Error("--exe must name a packaged Nyte executable.");
  const selected = startupCases.find((scenario) => scenario === values.scenario);

  if (values.scenario !== "all" && selected === undefined)
    throw new Error("--scenario must be all, fresh, restored, or heavy.");
  const runs = Number(values.runs);
  const warmup = Number(values.warmup);

  if (!Number.isSafeInteger(runs) || runs < 1)
    throw new Error("--runs must be a positive integer.");

  if (!Number.isSafeInteger(warmup) || warmup < 0)
    throw new Error("--warmup must be a nonnegative integer.");
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const builds: Build[] = [{ name: "baseline", executable: resolve(invokedFrom, values.exe) }];

  if (values.compare)
    builds.push({ name: "candidate", executable: resolve(invokedFrom, values.compare) });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

  return {
    builds,
    scenarios: selected === undefined ? startupCases : [selected],
    runs,
    warmup,
    output:
      values.out === undefined
        ? join(import.meta.dirname, "../test-results", `startup-${stamp}.json`)
        : resolve(invokedFrom, values.out),
    json: values.json,
  };
}

function launchEnvironment(fixture: StartupFixture) {
  const kept = new Set([
    "PATH",
    "SHELL",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "SystemRoot",
    "windir",
    "ComSpec",
    "PATHEXT",
  ]);

  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && kept.has(entry[0]),
  );

  return {
    ...Object.fromEntries(inherited),
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    CFFIXED_USER_HOME: fixture.home,
    APPDATA: join(fixture.directory, "app-data"),
    LOCALAPPDATA: join(fixture.directory, "local-app-data"),
    XDG_CONFIG_HOME: join(fixture.directory, "config"),
    XDG_CACHE_HOME: join(fixture.directory, "cache"),
    NYTE_OFFLINE: "1",
  };
}

/**
 * Records in main when each renderer host call arrives, so any build can be counted without
 * help from its preload. Electron emits its internal `-ipc-invoke` event on the sender's
 * session for every `ipcRenderer.invoke`, with the channel after the event; there is no
 * public event for invokes.
 */
async function recordHostCalls(application: ElectronApplication) {
  return application.evaluateHandle(({ session }, channel) => {
    const arrivals: number[] = [];
    const { EventEmitter } = process.getBuiltinModule("node:events");

    EventEmitter.prototype.on.call(
      session.defaultSession,
      "-ipc-invoke",
      (_event: Electron.IpcMainInvokeEvent, name: string) => {
        if (name === channel) arrivals.push(performance.timeOrigin + performance.now());
      },
    );

    return arrivals;
  }, CALL_CHANNEL);
}

async function inspectMain(application: ElectronApplication) {
  return application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
    executable: process.execPath,
    systemVersion: process.getSystemVersion(),
    home: process.env.HOME,
    userData: app.getPath("userData"),
    appData: app.getPath("appData"),
    nativeHome: app.getPath("home"),
    createdEpochMs: process.getCreationTime(),
    timeOriginEpochMs: performance.timeOrigin,
    nowMs: performance.now(),
    marks: performance.getEntriesByType("mark").map(({ name, startTime }) => ({ name, startTime })),
    nodeTiming: "nodeTiming" in performance ? performance.nodeTiming : null,
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    processes: app.getAppMetrics(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
}

/** Waits, polling every frame, for a composer that accepts input over the scenario's chat. */
async function waitForComposer(page: Page, expected: StartupFixture["expected"]) {
  const ready = await page.waitForFunction(
    (scenario) => {
      const field = document.querySelector('[aria-label="Message"][contenteditable="true"]');

      if (
        !(field instanceof HTMLElement) ||
        field.getAttribute("aria-disabled") === "true" ||
        !field.checkVisibility()
      )
        return false;

      const tab = document.querySelector(
        '[role="tablist"][aria-label="Tabs"] [role="tab"][aria-selected="true"]',
      );

      const title = scenario.kind === "chat" ? scenario.title : "New chat";

      if (
        ![tab?.getAttribute("aria-label"), tab?.textContent].some((name) => name?.includes(title))
      )
        return false;

      if (
        scenario.kind === "chat" &&
        !document
          .querySelector('[aria-label="Messages"] [role="log"]')
          ?.textContent?.includes(scenario.lastMessage)
      )
        return false;

      return { readyMs: performance.now() };
    },
    expected,
    { polling: "raf", timeout },
  );

  return Value.Parse(ReadySchema, await ready.jsonValue());
}

/**
 * Measures each keystroke from its keydown to the task after the frame that follows the
 * composer's first DOM change. Editors that cancel beforeinput fire no input event, so the
 * mutation is the editor-neutral sign that the character landed.
 */
async function typeAndMeasure(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const field = document.querySelector('[aria-label="Message"][contenteditable="true"]');

    if (field === null) throw new Error("The composer disappeared before typing.");
    let pending: number | undefined;
    document.addEventListener("keydown", (event) => (pending = event.timeStamp), true);
    new MutationObserver(() => {
      const start = pending;

      if (start === undefined) return;
      pending = undefined;
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          performance.measure(name, { start, end: performance.now() });
          channel.port1.close();
        };

        channel.port2.postMessage(null);
      });
    }).observe(field, { subtree: true, childList: true, characterData: true });
  }, keystrokeMeasure);

  const field = composer(page);

  const painted = (count: number) =>
    page.waitForFunction(
      ([name, expected]) => performance.getEntriesByName(name).length >= expected,
      [keystrokeMeasure, count] as const,
      { polling: "raf", timeout },
    );

  await field.pressSequentially(typedText.slice(0, 1), { timeout });
  await painted(1);
  await field.pressSequentially(typedText.slice(1), { delay: keystrokeDelayMs, timeout });
  await expect(field).toHaveText(typedText, { timeout });
  await painted(typedText.length);
}

async function inspectRenderer(page: Page, composerReadyMs: number) {
  return page.evaluate(
    async ([cutoff, keystroke]) => {
      const firstPaint = performance.getEntriesByName("first-paint")[0]?.startTime;
      const shellReady = performance.getEntriesByName("nyte:shell-ready")[0]?.startTime;

      if (firstPaint === undefined || shellReady === undefined)
        throw new Error(
          "Renderer lacks first-paint or nyte:shell-ready. Keep the window visible and use a build with startup marks.",
        );

      const longTasks = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? await new Promise<{ startTime: number; duration: number }[]>((done) => {
            const observer = new PerformanceObserver((list) => {
              observer.disconnect();
              done(list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
            });

            observer.observe({ type: "longtask", buffered: true });
            setTimeout(() => {
              observer.disconnect();
              done([]);
            }, 250);
          })
        : null;

      const resources = performance
        .getEntriesByType("resource")
        .filter(
          (entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming,
        )
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        }));

      return {
        timeOriginEpochMs: performance.timeOrigin,
        nowMs: performance.now(),
        firstPaintMs: firstPaint,
        firstContentfulPaintMs:
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        shellReadyMs: shellReady,
        composerReadyMs: cutoff,
        longTasks: longTasks === null ? null : longTasks.filter((task) => task.startTime < cutoff),
        keystrokes: performance
          .getEntriesByName(keystroke)
          .map(({ startTime, duration }) => ({ startTime, duration })),
        hostRequestsBeforeComposer: resources.filter(
          (entry) => entry.initiatorType === "fetch" && entry.startTime < cutoff,
        ).length,
        marks: performance
          .getEntriesByType("mark")
          .map(({ name, startTime }) => ({ name, startTime })),
        measures: performance
          .getEntriesByType("measure")
          .filter((entry) => entry.name !== keystroke)
          .map(({ name, startTime, duration }) => ({ name, startTime, duration })),
        resources,
        visibility: document.visibilityState,
      };
    },
    [composerReadyMs, keystrokeMeasure] as const,
  );
}

/** Counts the Electron process and every descendant, with their resident memory, via ps. */
async function inspectProcessTree(root: number | undefined) {
  if (root === undefined || process.platform === "win32") return null;
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="]);

  const rows = stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);

    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            residentBytes: Number(match[3]) * 1_024,
            command: match[4] ?? "",
          },
        ];
  });

  const tree = new Set([root]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const row of rows) {
      if (tree.has(row.pid) || !tree.has(row.parent)) continue;
      tree.add(row.pid);
      grew = true;
    }
  }

  return rows.filter((row) => tree.has(row.pid));
}

function phaseDuration(
  marks: readonly { readonly name: string; readonly startTime: number }[],
  start: string,
  end: string,
): number[] {
  const beginning = marks.find((mark) => mark.name === start);
  const ending = marks.find((mark) => mark.name === end);

  return beginning === undefined || ending === undefined
    ? []
    : [ending.startTime - beginning.startTime];
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();

  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((done) => child.once("exit", () => done()));

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      application.close(),
      new Promise<void>((done) => {
        timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          done();
        }, 5_000);
      }),
    ]);
    await exited;
  } catch (cause) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

/** Isolation holds when the profile stays inside the fixture, even for builds that ignore --user-data-dir. */
async function launch(build: Build, fixture: StartupFixture) {
  const application = await _electron.launch({
    executablePath: build.executable,
    args: [`--user-data-dir=${fixture.profile}`, "--use-mock-keychain", "--password-store=basic"],
    cwd: dirname(build.executable),
    env: launchEnvironment(fixture),
    timeout,
  });

  try {
    const paths = await application.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      home: process.env.HOME,
      userData: app.getPath("userData"),
    }));

    if (!paths.packaged) throw new Error("The supplied executable must launch a packaged app.");
    const profileInFixture = relative(fixture.directory, await realpath(paths.userData));

    if (
      paths.home !== fixture.home ||
      profileInFixture.startsWith("..") ||
      isAbsolute(profileInFixture)
    )
      throw new Error(`Isolation failed: HOME=${paths.home}, userData=${paths.userData}.`);

    return application;
  } catch (cause) {
    await closeApplication(application);
    throw cause;
  }
}

async function primeProfile(build: Build, fixture: StartupFixture): Promise<void> {
  if (fixture.expected.kind === "empty") return;
  const application = await launch(build, fixture);

  try {
    const page = await application.firstWindow({ timeout });
    await page.bringToFront();
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout });
    await openChat(page, fixture.expected.title);
    await expect(messages(page)).toContainText(fixture.expected.lastMessage, { timeout });
  } finally {
    await closeApplication(application);
  }
}

async function measure(identity: Identity, fixture: StartupFixture): Promise<Sample> {
  const output: string[] = [];
  const errors: string[] = [];
  const application = await launch(identity.build, fixture);
  const hostCalls = await recordHostCalls(application);
  const captured = new Set<Page>();

  const collectPage = (page: Page): void => {
    if (captured.has(page)) return;
    captured.add(page);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };

  for (const stream of [application.process().stdout, application.process().stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => output.push(chunk));
  }

  application.context().on("page", collectPage);

  try {
    const page = await application.firstWindow({ timeout });
    collectPage(page);
    await page.bringToFront();
    const ready = await waitForComposer(page, fixture.expected);

    if (fixture.expected.kind === "chat")
      await expect(chatTab(page, fixture.expected.title)).toHaveAttribute("aria-selected", "true");
    else await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");

    await typeAndMeasure(page);
    await clearComposer(page);
    const main = await inspectMain(application);
    const renderer = await inspectRenderer(page, ready.readyMs);

    const ipcCalls = await hostCalls.evaluate(
      (arrivals, readyEpochMs) => arrivals.filter((at) => at <= readyEpochMs).length,
      renderer.timeOriginEpochMs + ready.readyMs,
    );

    const processTree = await inspectProcessTree(application.process().pid);
    const cdp = await application.context().newCDPSession(page);
    const rendererHeap = await cdp.send("Runtime.getHeapUsage");
    await cdp.detach();
    const failures = errors.filter((error) => !error.startsWith("DEV:"));

    if (failures.length) throw new Error(`Renderer errors: ${failures.join("; ")}`);
    const created = main.createdEpochMs;

    const sinceSpawn = (rendererMs: number): number[] =>
      created === null ? [] : [renderer.timeOriginEpochMs + rendererMs - created];

    const firstKeystroke = renderer.keystrokes[0];
    const longTasks = renderer.longTasks ?? [];
    const fcp = renderer.firstContentfulPaintMs ?? renderer.firstPaintMs;

    return {
      kind: "complete",
      identity,
      fixture: {
        sessions: fixture.sessions,
        turns: fixture.turns,
        storeBytes: fixture.storeBytes,
      },
      main,
      renderer,
      processTree,
      errors,
      output,
      metrics: {
        spawnToTypedInputMs:
          firstKeystroke === undefined
            ? []
            : sinceSpawn(firstKeystroke.startTime + firstKeystroke.duration),
        spawnToComposerMs: sinceSpawn(ready.readyMs),
        spawnToFirstPaintMs: sinceSpawn(fcp),
        splashMs: [renderer.shellReadyMs - fcp],
        keystrokeToPaintMs: renderer.keystrokes.map(({ duration }) => duration),
        longTasks: renderer.longTasks === null ? [] : [longTasks.length],
        longTaskMs:
          renderer.longTasks === null
            ? []
            : [longTasks.reduce((total, task) => total + task.duration, 0)],
        longestTaskMs:
          renderer.longTasks === null
            ? []
            : [Math.max(0, ...longTasks.map((task) => task.duration))],
        ipcCalls: [ipcCalls],
        hostRequests: [renderer.hostRequestsBeforeComposer],
        mainHeapBytes: [main.memory.heapUsed],
        rendererHeapBytes: [rendererHeap.usedSize],
        processes: processTree === null ? [main.processes.length] : [processTree.length],
        residentBytes:
          processTree === null
            ? [
                main.processes.reduce(
                  (total, entry) => total + entry.memory.workingSetSize * 1_024,
                  0,
                ),
              ]
            : [processTree.reduce((total, row) => total + row.residentBytes, 0)],
        mainToWindowMs: phaseDuration(main.marks, "nyte:main-entry", "nyte:window-shown"),
        hostOpenMs: phaseDuration(main.marks, "nyte:shell-environment-ready", "nyte:host-opened"),
        listenerMs: phaseDuration(main.marks, "nyte:host-opened", "nyte:endpoint-ready"),
        sdkConnectMs: phaseDuration(renderer.marks, "nyte:startup", "nyte:sdk-connected"),
        dataLoadMs: phaseDuration(renderer.marks, "nyte:sdk-connected", "nyte:directory-ready"),
        routeMs: phaseDuration(renderer.marks, "nyte:startup-resources-loaded", "nyte:route-ready"),
      },
    };
  } catch (cause) {
    return {
      kind: "failed",
      identity,
      error: cause instanceof Error ? cause.message : String(cause),
      output,
    };
  } finally {
    await closeApplication(application);
  }
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];

  if (upper === undefined) return null;
  const lower = sorted[middle - 1] ?? upper;

  return {
    count: sorted.length,
    min: sorted[0] ?? upper,
    median: sorted.length % 2 === 0 ? (lower + upper) / 2 : upper,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? upper,
    max: sorted[sorted.length - 1] ?? upper,
  };
}

function summarize(samples: readonly Sample[], options: Options) {
  const judged = options.builds.at(-1)?.name;

  return options.builds.flatMap((build) =>
    options.scenarios.map((scenario) => {
      const selected = samples.filter(
        (sample) =>
          sample.identity.build.name === build.name &&
          sample.identity.scenario === scenario &&
          !sample.identity.warmup,
      );

      const completed = selected.flatMap((sample) => (sample.kind === "complete" ? [sample] : []));

      const metrics = metricFields.map((field) => {
        const stats = distribution(completed.flatMap((sample) => sample.metrics[field.key]));
        const budget = field.budget?.[scenario] ?? null;

        return {
          key: field.key,
          stats,
          budget,
          over: budget !== null && stats !== null && stats.p95 > budget,
        };
      });

      return {
        build: build.name,
        scenario,
        judged: build.name === judged,
        failures: selected.length - completed.length,
        metrics,
      };
    }),
  );
}

function formatValue(value: number, unit: (typeof metricFields)[number]["unit"]): string {
  if (unit === "bytes") return `${(value / MIB).toFixed(1)}M`;

  return unit === "count" ? value.toFixed(0) : value.toFixed(1);
}

async function run(options: Options): Promise<void> {
  for (const build of options.builds) await access(build.executable);
  const samples: Sample[] = [];

  for (const scenario of options.scenarios) {
    for (let repetition = 0; repetition < options.warmup + options.runs; repetition++) {
      const order = repetition % 2 === 0 ? options.builds : [...options.builds].reverse();

      for (const build of order) {
        const identity: Identity = {
          build,
          scenario,
          repetition,
          warmup: repetition < options.warmup,
        };

        process.stderr.write(
          `${build.name} ${scenario} ${identity.warmup ? "warmup" : "run"} ${repetition + 1}\n`,
        );
        const directory = await realpath(await mkdtemp(join(tmpdir(), "nyte-startup-")));

        try {
          const fixture = await prepareStartupFixture(directory, scenario);
          await primeProfile(build, fixture);
          samples.push(await measure(identity, fixture));
        } catch (cause) {
          samples.push({
            kind: "failed",
            identity,
            error: cause instanceof Error ? cause.message : String(cause),
            output: [],
          });
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }

  const summaries = summarize(samples, options);

  const report = {
    version: 2,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    options,
    budgets: Object.fromEntries(metricFields.map((field) => [field.key, field.budget])),
    samples,
    summaries,
    clocks: {
      spawn:
        "Renderer epoch (performance.timeOrigin + startTime) minus Electron main process.getCreationTime().",
      composer:
        "Renderer performance.now() on the first animation frame where the composer is editable, visible, and over the scenario's chat.",
      typedInput:
        "The task after the frame that follows the composer's first DOM mutation for the first typed character (requestAnimationFrame, then a MessageChannel task).",
      keystroke: `Each of ${typedText.length} characters typed ${keystrokeDelayMs} ms apart right after the composer is ready: keydown timeStamp to the task after the frame that follows the composer's DOM mutation.`,
      splash: "nyte:shell-ready (first frame after the interface replaces #startup) minus FCP.",
      longTasks: "Buffered PerformanceObserver longtask entries that start before composer ready.",
      ipc: "Host calls (ipcRenderer.invoke on the call channel) that reached main before composer ready, recorded in main from Electron's session -ipc-invoke event.",
      hostRequests: "Completed fetch resource entries started before composer ready.",
      heap: "Main process.memoryUsage().heapUsed and renderer CDP Runtime.getHeapUsage usedSize after typing.",
      processes: "ps descendants of the Electron main process, including it, with summed RSS.",
      budgets: "Each budget is a p95 ceiling for the judged build, the last one given.",
    },
    instrumentation: [
      "--inspect=0",
      "--remote-debugging-port=0",
      "--use-mock-keychain",
      "--password-store=basic",
      "NYTE_OFFLINE=1",
    ],
  };

  await mkdir(dirname(options.output), { recursive: true });
  const json = JSON.stringify(report, null, 2) + "\n";
  await writeFile(options.output, json);

  if (options.json) process.stdout.write(json);
  else {
    process.stdout.write(
      "Build     Scenario  Metric                            Median      p95      Min      Max   Budget\n",
    );

    for (const summary of summaries) {
      for (const [index, field] of metricFields.entries()) {
        const { stats, budget, over } = summary.metrics[index] ?? {};

        const numbers =
          stats === null || stats === undefined
            ? "       -        -        -        -"
            : [stats.median, stats.p95, stats.min, stats.max]
                .map((value) => formatValue(value, field.unit).padStart(8))
                .join(" ");

        const verdict =
          budget === null || budget === undefined
            ? ""
            : `${formatValue(budget, field.unit).padStart(8)}${summary.judged && over ? " OVER" : ""}`;

        process.stdout.write(
          `${summary.build.padEnd(9)} ${summary.scenario.padEnd(9)} ${field.label.padEnd(33)} ${numbers} ${verdict}\n`,
        );
      }

      process.stdout.write(`  Failed: ${summary.failures}\n`);
    }

    process.stdout.write(`Raw report: ${options.output}\n`);
  }

  for (const sample of samples)
    if (sample.kind === "failed")
      process.stderr.write(
        `${sample.identity.build.name} ${sample.identity.scenario}: ${sample.error}\n`,
      );

  const overBudget = summaries.flatMap((summary) =>
    summary.judged
      ? summary.metrics
          .filter((metric) => metric.over)
          .map((metric) => `${summary.scenario} ${metric.key}`)
      : [],
  );

  if (overBudget.length > 0) process.stderr.write(`Over budget: ${overBudget.join(", ")}\n`);

  if (samples.some((sample) => sample.kind === "failed") || overBudget.length > 0)
    process.exitCode = 1;
}

try {
  const options = readOptions();

  if (options !== undefined) await run(options);
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
}
