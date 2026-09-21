import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import electronExecutable from "electron";
import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createDesktopBenchmarkFixture } from "./fixtures.ts";
import type { DesktopBenchmarkFixture, DesktopBenchmarkFixtureOptions } from "./fixtures.ts";
import packageMetadata from "../package.json" with { type: "json" };

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");

export interface DesktopStartupTiming {
  readonly launchStartedAtUnixMs: number;
  readonly electronConnectedMs: number;
  readonly firstWindowMs: number;
  readonly shellReadyMs: number;
  readonly renderer: Awaited<ReturnType<typeof rendererStartupTiming>>;
}

export interface DesktopLaunchOptions extends DesktopBenchmarkFixtureOptions {
  readonly startupDestination?: "new-chat" | "last-session";
}

export interface LaunchedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly fixture: DesktopBenchmarkFixture;
  readonly processId: number;
  readonly buildRoot: string;
  readonly profilePreparation: "fresh" | "startup-destination";
  readonly startup: DesktopStartupTiming;
  readonly pageErrors: readonly string[];
  startupElapsedMs(): number;
  close(): Promise<void>;
}

async function rendererStartupTiming(page: Page) {
  return page.evaluate(() => {
    const navigation = performance
      .getEntriesByType("navigation")
      .find((entry) => entry instanceof PerformanceNavigationTiming);
    const paints = performance.getEntriesByType("paint");
    const firstPaint = paints.find((entry) => entry.name === "first-paint");
    const firstContentfulPaint = paints.find((entry) => entry.name === "first-contentful-paint");
    return {
      navigation:
        navigation === undefined
          ? null
          : {
              responseEndMs: navigation.responseEnd,
              domContentLoadedMs: navigation.domContentLoadedEventEnd,
              loadMs: navigation.loadEventEnd,
            },
      paints: {
        firstPaintMs: firstPaint?.startTime ?? null,
        firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
      },
      marks: performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("nyte:"))
        .map((entry) => ({ name: entry.name, startTimeMs: entry.startTime })),
      measures: performance
        .getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("nyte:"))
        .map((entry) => ({
          name: entry.name,
          startTimeMs: entry.startTime,
          durationMs: entry.duration,
        })),
    };
  });
}

export async function launchDesktop(options: DesktopLaunchOptions = {}): Promise<LaunchedDesktop> {
  if (typeof electronExecutable !== "string") {
    throw new Error("Expected Electron to resolve to its executable path");
  }
  const buildRoot = resolve(
    process.env.NYTE_DESKTOP_BENCHMARK_BUILD_ROOT ?? resolve(DESKTOP_ROOT, "out"),
  );
  const mainEntry = resolve(buildRoot, "main/index.js");
  await access(mainEntry).catch(() => {
    throw new Error(`Desktop benchmark build is missing ${mainEntry}`);
  });
  const fixture = await createDesktopBenchmarkFixture(options);
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const environment = {
    ...inheritedEnvironment,
    ...fixture.env,
    OPENCODE_API_KEY: "desktop-benchmark",
  };

  let application: ElectronApplication | undefined;
  try {
    const appData = resolve(fixture.paths.root, "app-data");
    const userData = resolve(appData, "user-data");
    await mkdir(appData);
    await writeFile(
      resolve(fixture.paths.root, "environment.mjs"),
      `import { app } from "electron";\napp.setPath("appData", ${JSON.stringify(appData)});\napp.setPath("userData", ${JSON.stringify(userData)});\n`,
    );
    const entry = resolve(fixture.paths.root, "entry.mjs");
    await writeFile(
      entry,
      `import "./environment.mjs";\nimport ${JSON.stringify(pathToFileURL(mainEntry).href)};\n`,
    );
    await writeFile(
      resolve(fixture.paths.root, "package.json"),
      JSON.stringify({
        name: packageMetadata.name,
        version: packageMetadata.version,
        main: "entry.mjs",
      }),
    );
    await symlink(
      resolve(DESKTOP_ROOT, "resources"),
      resolve(fixture.paths.root, "resources"),
      "junction",
    );

    const launchOptions = {
      executablePath: electronExecutable,
      args: [fixture.paths.root],
      cwd: DESKTOP_ROOT,
      env: environment,
      timeout: 30_000,
    };
    const profilePreparation =
      options.startupDestination === "last-session" ? "startup-destination" : "fresh";
    if (profilePreparation === "startup-destination") {
      const preparation = await _electron.launch(launchOptions);
      try {
        const page = await preparation.firstWindow();
        await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
        await page.getByRole("button", { name: "Open settings" }).click();
        const restoration = page.getByRole("combobox", { name: "Window restoration" });
        await restoration.click();
        await page.getByRole("option", { name: "Last chat" }).click();
        await restoration.getByText("Last chat", { exact: true }).waitFor({ state: "visible" });
      } finally {
        await preparation.close().catch(() => undefined);
      }
    }

    const launchStartedAtUnixMs = Date.now();
    const launchStartedAt = performance.now();
    application = await _electron.launch(launchOptions);
    const connected = application;
    const electronConnectedMs = performance.now() - launchStartedAt;
    const processId = connected.process().pid;
    if (processId === undefined) throw new Error("Electron did not expose its process id");
    const pageErrors: string[] = [];
    const page = await connected.firstWindow();
    const firstWindowMs = performance.now() - launchStartedAt;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByRole("button", { name: /New Chat/u }).waitFor({ state: "visible" });
    await page.getByText("Opening your workspace…", { exact: true }).waitFor({
      state: "detached",
      timeout: 30_000,
    });
    const firstSession = fixture.sessions[0];
    if (firstSession !== undefined) {
      await page
        .getByRole("navigation", { name: "Sessions and workspaces" })
        .getByRole("button", { name: firstSession.name })
        .waitFor({ state: "visible" });
    }
    const shellReadyMs = performance.now() - launchStartedAt;
    const renderer = await rendererStartupTiming(page);
    let closed = false;
    return {
      application: connected,
      page,
      fixture,
      processId,
      buildRoot,
      profilePreparation,
      startup: {
        launchStartedAtUnixMs,
        electronConnectedMs,
        firstWindowMs,
        shellReadyMs,
        renderer,
      },
      pageErrors,
      startupElapsedMs: () => performance.now() - launchStartedAt,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await connected.close().catch(() => undefined);
        } finally {
          await fixture.cleanup();
        }
      },
    };
  } catch (error) {
    await application?.close().catch(() => undefined);
    await fixture.cleanup();
    throw error;
  }
}

export async function openBenchmarkSession(desktop: LaunchedDesktop, index: number): Promise<void> {
  const session = desktop.fixture.sessions[index];
  if (session === undefined)
    throw new RangeError(`Unknown benchmark session index ${String(index)}`);
  await desktop.page
    .getByRole("navigation", { name: "Sessions and workspaces" })
    .getByRole("button", { name: session.name })
    .click();
  await desktop.page
    .getByRole("region", { name: "Active chat pane" })
    .getByText(`Benchmark prompt 0001 for ${session.name}`, { exact: true })
    .last()
    .waitFor();
}
