import { _electron, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { prepareStartupFixture, startupCases } from "./startup-fixture.ts";
import type { StartupCase, StartupFixture } from "./startup-fixture.ts";
import { chatTab, clearComposer, composer, messages, openChat } from "./ui.ts";

const timeout = 30_000;

const splashLimitMs = 5_000;

const HeapSchema = Type.Object({
  usedBytes: Type.Number(),
  totalBytes: Type.Number(),
  limitBytes: Type.Number(),
});

const metricFields = [
  { key: "processToComposerMs", label: "Process to composer" },
  { key: "launchToComposerMs", label: "Launch request to composer" },
  { key: "launchToInputMs", label: "Launch request to typed input" },
  { key: "splashMs", label: "Splash to usable input" },
  { key: "hostOpenMs", label: "Main: host opening" },
  { key: "listenerMs", label: "Main: listener binding" },
  { key: "sdkConnectMs", label: "Renderer: SDK connection" },
  { key: "dataLoadMs", label: "Renderer: initial data" },
  { key: "routeMs", label: "Renderer: initial route" },
] as const;

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

interface Metrics {
  readonly hostOpenMs: number | null;
  readonly listenerMs: number | null;
  readonly sdkConnectMs: number | null;
  readonly dataLoadMs: number | null;
  readonly routeMs: number | null;
  readonly processToComposerMs: number | null;
  readonly launchToWindowMs: number;
  readonly launchToShellMs: number;
  readonly launchToComposerMs: number;
  readonly launchToInputMs: number;
  readonly firstPaintMs: number;
  readonly firstContentfulPaintMs: number | null;
  readonly firstPaintToShellMs: number;
  readonly splashMs: number;
}

type Sample =
  | {
      readonly kind: "complete";
      readonly identity: Identity;
      readonly fixture: Pick<StartupFixture, "sessions" | "turns" | "models" | "storeBytes">;
      readonly metrics: Metrics;
      readonly main: Awaited<ReturnType<typeof inspectMain>>;
      readonly renderer: Awaited<ReturnType<typeof inspectRenderer>>;
      readonly errors: readonly string[];
      readonly output: readonly string[];
    }
  | {
      readonly kind: "failed";
      readonly identity: Identity;
      readonly error: string;
      readonly output: readonly string[];
    };

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
      "Usage: pnpm --dir packages/app bench:desktop --exe <packaged executable> [--compare <executable>]\n" +
        "  --scenario all|fresh|restored|heavy  --runs 5  --warmup 1  --out <report.json>  --json\n" +
        "On macOS, pass Nyte.app/Contents/MacOS/Nyte. No build or dev server is started.\n",
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
  const builds: Build[] = [{ name: "baseline", executable: resolve(values.exe) }];

  if (values.compare) builds.push({ name: "candidate", executable: resolve(values.compare) });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

  return {
    builds,
    scenarios: selected === undefined ? startupCases : [selected],
    runs,
    warmup,
    output: resolve(
      values.out ?? join(import.meta.dirname, "../test-results", `startup-${stamp}.json`),
    ),
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

async function inspectRenderer(page: Page, inputConfirmedMs: number) {
  const renderer = await page.evaluate((inputConfirmed) => {
    const firstPaint = performance.getEntriesByName("first-paint")[0]?.startTime;
    const shellReady = performance.getEntriesByName("nyte:shell-ready")[0]?.startTime;

    if (firstPaint === undefined || shellReady === undefined)
      throw new Error(
        "Renderer lacks first-paint or nyte:shell-ready. Keep the window visible and use a build with startup marks.",
      );
    const memory: object = Object("memory" in performance ? performance.memory : null);

    const heap = {
      usedBytes: "usedJSHeapSize" in memory ? memory.usedJSHeapSize : null,
      totalBytes: "totalJSHeapSize" in memory ? memory.totalJSHeapSize : null,
      limitBytes: "jsHeapSizeLimit" in memory ? memory.jsHeapSizeLimit : null,
    };

    return {
      timeOriginEpochMs: performance.timeOrigin,
      nowMs: performance.now(),
      firstPaintMs: firstPaint,
      firstContentfulPaintMs:
        performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      shellReadyMs: shellReady,
      inputConfirmedMs: inputConfirmed,
      marks: performance
        .getEntriesByType("mark")
        .map(({ name, startTime }) => ({ name, startTime })),
      measures: performance
        .getEntriesByType("measure")
        .map(({ name, startTime, duration }) => ({ name, startTime, duration })),
      resources: performance
        .getEntriesByType("resource")
        .filter(
          (entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming,
        )
        .map((entry) => ({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
      visibility: document.visibilityState,
      heap,
    };
  }, inputConfirmedMs);

  return { ...renderer, heap: Value.Check(HeapSchema, renderer.heap) ? renderer.heap : null };
}

function phaseDuration(
  marks: Awaited<ReturnType<typeof inspectMain>>["marks"],
  start: string,
  end: string,
): number | null {
  const beginning = marks.find((mark) => mark.name === start);
  const ending = marks.find((mark) => mark.name === end);

  return beginning === undefined || ending === undefined
    ? null
    : ending.startTime - beginning.startTime;
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

    if (paths.home !== fixture.home || resolve(paths.userData) !== resolve(fixture.profile))
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
  const start = performance.now();
  const application = await launch(identity.build, fixture);
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
    const launchToWindowMs = performance.now() - start;
    collectPage(page);
    await page.bringToFront();
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout });
    const launchToShellMs = performance.now() - start;

    if (fixture.expected.kind === "chat") {
      await expect(chatTab(page, fixture.expected.title)).toHaveAttribute("aria-selected", "true", {
        timeout,
      });
      await expect(messages(page)).toContainText(fixture.expected.lastMessage, { timeout });
    } else {
      await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true", { timeout });
    }

    await expect(composer(page)).toBeVisible({ timeout });
    await expect(composer(page)).toBeEditable({ timeout });
    const launchToComposerMs = performance.now() - start;
    const composerEpochMs = Date.now();
    const marker = "Startup benchmark input";
    await composer(page).fill(marker, { timeout });
    await expect(composer(page)).toHaveText(marker, { timeout });
    const launchToInputMs = performance.now() - start;
    const inputConfirmedMs = await page.evaluate(() => performance.now());
    await clearComposer(page);
    const main = await inspectMain(application);
    const renderer = await inspectRenderer(page, inputConfirmedMs);
    const failures = errors.filter((error) => !error.startsWith("DEV:"));

    if (failures.length) throw new Error(`Renderer errors: ${failures.join("; ")}`);

    return {
      kind: "complete",
      identity,
      fixture: {
        sessions: fixture.sessions,
        turns: fixture.turns,
        models: fixture.models,
        storeBytes: fixture.storeBytes,
      },
      main,
      renderer,
      errors,
      output,
      metrics: {
        hostOpenMs: phaseDuration(main.marks, "nyte:shell-environment-ready", "nyte:host-opened"),
        listenerMs: phaseDuration(main.marks, "nyte:host-opened", "nyte:endpoint-ready"),
        sdkConnectMs: phaseDuration(renderer.marks, "nyte:startup", "nyte:sdk-connected"),
        dataLoadMs: phaseDuration(renderer.marks, "nyte:sdk-connected", "nyte:directory-ready"),
        routeMs: phaseDuration(renderer.marks, "nyte:startup-resources-loaded", "nyte:route-ready"),
        processToComposerMs:
          main.createdEpochMs === null ? null : composerEpochMs - main.createdEpochMs,
        launchToWindowMs,
        launchToShellMs,
        launchToComposerMs,
        launchToInputMs,
        firstPaintMs: renderer.firstPaintMs,
        firstContentfulPaintMs: renderer.firstContentfulPaintMs,
        firstPaintToShellMs: renderer.shellReadyMs - renderer.firstPaintMs,
        splashMs:
          renderer.inputConfirmedMs - (renderer.firstContentfulPaintMs ?? renderer.firstPaintMs),
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
    min: sorted[0],
    median: sorted.length % 2 === 0 ? (lower + upper) / 2 : upper,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
  };
}

function summarize(samples: readonly Sample[], options: Options) {
  return options.builds.flatMap((build) =>
    options.scenarios.map((scenario) => {
      const selected = samples.filter(
        (sample) =>
          sample.identity.build.name === build.name &&
          sample.identity.scenario === scenario &&
          !sample.identity.warmup,
      );

      const completed = selected.filter((sample) => sample.kind === "complete");

      return {
        build: build.name,
        scenario,
        failures: selected.length - completed.length,
        over5Seconds: completed.filter((sample) => sample.metrics.splashMs > splashLimitMs).length,
        metrics: Object.fromEntries(
          metricFields.map(({ key }) => [
            key,
            distribution(
              completed.flatMap((sample) => {
                const value = sample.metrics[key];

                return value === null ? [] : [value];
              }),
            ),
          ]),
        ),
      };
    }),
  );
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
    version: 1,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    options,
    samples,
    summaries,
    splashLimitMs,
    clocks: {
      launch:
        "Parent performance.now() immediately before Playwright launch to observed milestone; includes inspector attachment and polling.",
      process:
        "Parent Date.now() at composer observation minus Electron process.getCreationTime(), both epoch milliseconds.",
      renderer:
        "Buffered first-paint, FCP, nyte:shell-ready, and input confirmation share renderer performance.timeOrigin. Splash is input confirmation minus FCP, falling back to first-paint.",
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
      "Build     Scenario   Metric                          Median     p95      Min      Max\n",
    );

    for (const summary of summaries) {
      for (const { key, label } of metricFields) {
        const stats = summary.metrics[key];

        const numbers =
          stats === null || stats === undefined
            ? "       -        -        -        -"
            : [stats.median, stats.p95, stats.min, stats.max]
                .map((value) => value?.toFixed(1).padStart(8) ?? "       -")
                .join(" ");

        process.stdout.write(
          `${summary.build.padEnd(9)} ${summary.scenario.padEnd(10)} ${label.padEnd(31)} ${numbers}\n`,
        );
      }

      process.stdout.write(
        `  Failed: ${summary.failures}; splash over 5 seconds: ${summary.over5Seconds}\n`,
      );
    }

    process.stdout.write(`Milliseconds. Raw report: ${options.output}\n`);
  }

  for (const sample of samples)
    if (sample.kind === "failed")
      process.stderr.write(
        `${sample.identity.build.name} ${sample.identity.scenario}: ${sample.error}\n`,
      );

  if (
    samples.some((sample) => sample.kind === "failed") ||
    summaries.some((summary) => summary.over5Seconds > 0)
  )
    process.exitCode = 1;
}

try {
  const options = readOptions();

  if (options !== undefined) await run(options);
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
}
