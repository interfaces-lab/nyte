// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/devex/desktop-startup-benchmark.spec.ts
import type { LaunchedDesktop, DesktopLaunchOptions } from "./desktop.ts";
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop } from "./desktop.ts";
import { DEFAULT_ASSISTANT_MARKDOWN } from "./fixtures.ts";
import { measureSettledDesktop } from "./measure.ts";

const LARGE_TRANSCRIPT_TURNS = 160;
const LARGE_ASSISTANT_MARKDOWN = Array.from(
  { length: 8 },
  (_, index) => `## Transcript section ${String(index + 1)}\n\n${DEFAULT_ASSISTANT_MARKDOWN}`,
).join("\n");

async function measureStartup(
  options: DesktopLaunchOptions,
  ready: (desktop: LaunchedDesktop) => Promise<void>,
  backgroundReady?: (desktop: LaunchedDesktop) => Promise<void>,
) {
  const desktop = await launchDesktop(options);
  try {
    await ready(desktop);
    const usefulScreenMs = desktop.startupElapsedMs();
    await backgroundReady?.(desktop);
    const settledScreenMs = desktop.startupElapsedMs();
    const idle = await measureSettledDesktop(desktop);
    expect(desktop.pageErrors).toEqual([]);
    return {
      metrics: {
        startup: { ...desktop.startup, usefulScreenMs, settledScreenMs },
        idle: { processes: idle },
      },
      context: {
        buildRoot: desktop.buildRoot,
        profilePreparation: desktop.profilePreparation,
        fixture: desktop.fixture.metadata,
      },
    };
  } finally {
    await desktop.close();
  }
}

async function expectComposer(desktop: LaunchedDesktop): Promise<void> {
  const pane = desktop.page.getByRole("region", { name: "Active chat pane" });
  await expect(pane.getByRole("form", { name: "Message composer" })).toBeVisible();
}

benchmark("opens a cold desktop on empty Home", async ({ report }) => {
  const result = await measureStartup(
    { sessionCount: 0, turnsPerSession: 1, workspaceCount: 0, rememberWorkspace: false },
    async (desktop) => {
      await expectComposer(desktop);
      await expect(desktop.page.getByText("No sessions yet", { exact: true })).toHaveCount(1);
    },
  );
  report(result.metrics, result.context);
});

benchmark("opens Home with 50 saved workspaces", async ({ report }) => {
  const result = await measureStartup(
    { sessionCount: 0, turnsPerSession: 1, workspaceCount: 50, rememberWorkspace: false },
    expectComposer,
    async (desktop) => {
      const directories = await desktop.page.evaluate(() => window.nyte.host.sessionDirectory());
      expect(directories).toHaveLength(51);
    },
  );
  report(result.metrics, result.context);
});

benchmark("restores a 160-turn transcript", async ({ report }) => {
  const result = await measureStartup(
    {
      sessionCount: 1,
      turnsPerSession: LARGE_TRANSCRIPT_TURNS,
      assistantMarkdown: LARGE_ASSISTANT_MARKDOWN,
      startupDestination: "last-session",
    },
    async (desktop) => {
      await expectComposer(desktop);
      const session = desktop.fixture.sessions[0];
      if (session === undefined) throw new Error("Missing restored benchmark session");
      const pane = desktop.page.getByRole("region", { name: "Active chat pane" });
      await expect(
        desktop.page.getByRole("banner").getByText(session.name, { exact: true }),
      ).toBeVisible();
      await expect(
        pane.getByText(`Benchmark prompt 0160 for ${session.name}`, { exact: true }),
      ).toBeVisible();
    },
  );
  report(result.metrics, result.context);
});

benchmark("restores a project while the login shell takes two seconds", async ({ report }) => {
  const result = await measureStartup(
    {
      sessionCount: 0,
      turnsPerSession: 1,
      workspaceCount: 1,
      rememberWorkspace: true,
      loginShellDelayMs: 2_000,
    },
    expectComposer,
  );
  report(result.metrics, result.context);
});

benchmark("opens while a configured loopback server never responds", async ({ report }) => {
  const result = await measureStartup(
    {
      sessionCount: 0,
      turnsPerSession: 1,
      workspaceCount: 0,
      rememberWorkspace: false,
      server: "delayed-loopback",
    },
    expectComposer,
  );
  report(result.metrics, result.context);
});
