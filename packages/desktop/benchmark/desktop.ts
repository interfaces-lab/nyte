import { _electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import electronExecutable from "electron";
import { resolve } from "node:path";
import process from "node:process";
import { createDesktopBenchmarkFixture } from "./fixtures.ts";
import type { DesktopBenchmarkFixture, DesktopBenchmarkFixtureOptions } from "./fixtures.ts";

const DESKTOP_ROOT = resolve(import.meta.dirname, "..");

export interface DesktopStartupTiming {
  readonly electronConnectedMs: number;
  readonly firstWindowMs: number;
  readonly shellReadyMs: number;
}

export interface LaunchedDesktop {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly fixture: DesktopBenchmarkFixture;
  readonly processId: number;
  readonly startup: DesktopStartupTiming;
  readonly pageErrors: readonly string[];
  close(): Promise<void>;
}

export async function launchDesktop(
  options: DesktopBenchmarkFixtureOptions = {},
): Promise<LaunchedDesktop> {
  if (typeof electronExecutable !== "string") {
    throw new Error("Expected Electron to resolve to its executable path");
  }
  const fixture = await createDesktopBenchmarkFixture(options);
  const launchStartedAtMs = performance.now();
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
    application = await _electron.launch({
      executablePath: electronExecutable,
      args: ["."],
      cwd: DESKTOP_ROOT,
      env: environment,
      timeout: 30_000,
    });
    const connected = application;
    const electronConnectedMs = performance.now() - launchStartedAtMs;
    const processId = connected.process().pid;
    if (processId === undefined) throw new Error("Electron did not expose its process id");
    const pageErrors: string[] = [];
    const page = await connected.firstWindow();
    const firstWindowMs = performance.now() - launchStartedAtMs;
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
    const shellReadyMs = performance.now() - launchStartedAtMs;
    let closed = false;
    return {
      application: connected,
      page,
      fixture,
      processId,
      startup: { electronConnectedMs, firstWindowMs, shellReadyMs },
      pageErrors,
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
