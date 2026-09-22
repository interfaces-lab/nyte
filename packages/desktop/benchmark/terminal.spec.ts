// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/terminals/terminal-benchmark.spec.ts
// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/regression/terminal-tab-switch.spec.ts
import type { Locator } from "@playwright/test";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import type { LaunchedDesktop } from "./desktop.ts";
import type { DesktopBenchmarkFixture } from "./fixtures.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";
import { readProcessTree } from "./process-metrics.ts";

const OUTPUT_LINE_COUNT = 12_000;

const TAB_SWITCH_CYCLES = 5;

const FILE_WAIT_TIMEOUT_MS = 60_000;

type TerminalProcessObservation =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "observed";
      readonly pid: number;
      readonly command: string;
      readonly matchingProcessCount: number;
    };

async function createTerminalBenchmarkPaths(fixture: DesktopBenchmarkFixture) {
  const paths = {
    output: join(fixture.paths.workspace, "terminal-benchmark-12000-lines.txt"),
    hiddenComplete: join(fixture.paths.workspace, ".terminal-hidden-complete"),
    hiddenResponsive: join(fixture.paths.workspace, ".terminal-hidden-responsive"),
    teardownComplete: join(fixture.paths.workspace, ".terminal-teardown-complete"),
    terminalPid: join(fixture.paths.workspace, ".terminal-process-pid"),
    switchedResponsive: join(fixture.paths.workspace, ".terminal-switched-responsive"),
  };

  const contents =
    Array.from(
      { length: OUTPUT_LINE_COUNT },
      (_, index) => `nyte-terminal-benchmark-line-${String(index + 1).padStart(5, "0")}`,
    ).join("\n") + "\n";

  await writeFile(paths.output, contents, "utf8");

  return paths;
}

async function waitForPath(path: string): Promise<void> {
  const deadline = performance.now() + FILE_WAIT_TIMEOUT_MS;
  let latestError: unknown;

  while (performance.now() < deadline) {
    try {
      await access(path);

      return;
    } catch (cause: unknown) {
      latestError = cause;
      await setTimeout(50);
    }
  }

  throw new Error(`Timed out waiting for terminal sentinel ${path}`, { cause: latestError });
}

function quoteShellPath(path: string): string {
  return `'${path.replaceAll("'", `'"'"'`)}'`;
}

async function sendShellCommand(input: Locator, command: string): Promise<void> {
  await input.focus();
  await input.pressSequentially(command);
  await input.press("Enter");
}

async function openTerminal(desktop: LaunchedDesktop) {
  const navigation = desktop.page.getByRole("navigation", { name: "Workbench navigation" });
  await navigation.getByRole("button", { name: "Terminal", exact: true }).click();
  const terminal = desktop.page.getByRole("region", { name: "Terminal", exact: true });
  const input = terminal.getByRole("textbox", { name: "Terminal input", exact: true });
  const canvas = terminal.locator("canvas").first();
  await expect(input).toBeAttached();
  await expect(canvas).toBeVisible();

  return { canvas, input };
}

async function markCanvas(canvas: Locator, marker: string): Promise<Locator> {
  await canvas.evaluate((element, value) => {
    element.setAttribute("data-nyte-benchmark-canvas", value);
  }, marker);

  return canvas.page().locator(`canvas[data-nyte-benchmark-canvas="${marker}"]`);
}

async function observeTerminalProcess(
  desktop: LaunchedDesktop,
  input: Locator,
  pidPath: string,
): Promise<TerminalProcessObservation> {
  if (process.platform === "win32") return { kind: "unavailable" };
  await sendShellCommand(input, `printf '%s\\n' "$$" > ${quoteShellPath(pidPath)}`);
  await waitForPath(pidPath);
  const value = (await readFile(pidPath, "utf8")).trim();

  if (!/^\d+$/u.test(value)) throw new Error(`Terminal returned an invalid PID: ${value}`);
  const pid = Number(value);

  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Terminal returned an invalid PID: ${value}`);
  }

  const tree = await readProcessTree(desktop.processId);
  const terminalProcess = tree.find((candidate) => candidate.pid === pid);

  if (terminalProcess === undefined) {
    throw new Error(`Terminal process ${String(pid)} was not in the Nyte process tree`);
  }

  return {
    kind: "observed",
    pid,
    command: terminalProcess.command,
    matchingProcessCount: tree.filter((candidate) => candidate.command === terminalProcess.command)
      .length,
  };
}

benchmark("hidden-output", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 1, turnsPerSession: 1 });

  try {
    const paths = await createTerminalBenchmarkPaths(desktop.fixture);
    await openBenchmarkSession(desktop, 0);
    const terminal = await openTerminal(desktop);
    const markedCanvas = await markCanvas(terminal.canvas, "hidden-output");

    const action = await measureOperation(desktop, async () => {
      await sendShellCommand(
        terminal.input,
        `sleep 1 && cat ${quoteShellPath(paths.output)} && touch ${quoteShellPath(paths.hiddenComplete)}`,
      );
      await desktop.page
        .getByRole("banner")
        .getByRole("button", { name: "Hide workbench", exact: true })
        .click();
      await expect(markedCanvas).toHaveCount(1);
      await expect(markedCanvas).toBeHidden();
      await waitForPath(paths.hiddenComplete);

      await desktop.page
        .getByRole("banner")
        .getByRole("button", { name: "Show workbench", exact: true })
        .click();
      await expect(markedCanvas).toBeVisible();
      await sendShellCommand(terminal.input, `touch ${quoteShellPath(paths.hiddenResponsive)}`);
      await waitForPath(paths.hiddenResponsive);
    });

    const settleEnergy = await measureSettledDesktop(desktop);

    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        action: { durationMs: action.durationMs, processEnergy: action.processes },
        postSettle: { processEnergy: settleEnergy },
      },
      { fixture: desktop.fixture.metadata, outputLineCount: OUTPUT_LINE_COUNT },
    );
  } finally {
    await desktop.close();
  }
});

benchmark("full-scrollback-teardown", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 1, turnsPerSession: 1 });

  try {
    const paths = await createTerminalBenchmarkPaths(desktop.fixture);
    await openBenchmarkSession(desktop, 0);
    const terminal = await openTerminal(desktop);

    const processObservation = await observeTerminalProcess(
      desktop,
      terminal.input,
      paths.terminalPid,
    );

    const action = await measureOperation(desktop, async () => {
      await sendShellCommand(
        terminal.input,
        `cat ${quoteShellPath(paths.output)} && touch ${quoteShellPath(paths.teardownComplete)}`,
      );
      await waitForPath(paths.teardownComplete);
      const tabList = desktop.page.getByRole("tablist", { name: "Workbench tabs" });
      await tabList.getByRole("tab", { selected: true }).press("Delete");
      const confirm = desktop.page.getByRole("button", { name: "Close terminal", exact: true });
      await expect
        .poll(async () => (await terminal.input.count()) === 0 || (await confirm.isVisible()))
        .toBe(true);

      if (await confirm.isVisible()) await confirm.click();
      await expect(terminal.canvas).toHaveCount(0);
      await expect(terminal.input).toHaveCount(0);

      if (processObservation.kind === "observed") {
        await expect
          .poll(async () => {
            const tree = await readProcessTree(desktop.processId);

            return tree?.some((candidate) => candidate.pid === processObservation.pid) ?? false;
          })
          .toBe(false);
      }
    });

    const settleEnergy = await measureSettledDesktop(desktop);

    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        action: { durationMs: action.durationMs, processEnergy: action.processes },
        postSettle: { processEnergy: settleEnergy },
      },
      {
        fixture: desktop.fixture.metadata,
        outputLineCount: OUTPUT_LINE_COUNT,
        terminalProcessObserved: processObservation.kind === "observed",
      },
    );
  } finally {
    await desktop.close();
  }
});

benchmark(
  "keeps terminal visibility per tab and the PTY alive across tab switches",
  async ({ report }) => {
    const desktop = await launchDesktop({ sessionCount: 2, turnsPerSession: 1 });

    try {
      const paths = await createTerminalBenchmarkPaths(desktop.fixture);
      await openBenchmarkSession(desktop, 0);
      const terminal = await openTerminal(desktop);
      const markedCanvas = await markCanvas(terminal.canvas, "tab-switch");

      const processObservation = await observeTerminalProcess(
        desktop,
        terminal.input,
        paths.terminalPid,
      );

      const action = await measureOperation(desktop, async () => {
        for (let cycle = 0; cycle < TAB_SWITCH_CYCLES; cycle += 1) {
          await openBenchmarkSession(desktop, 1);
          await expect(markedCanvas).toHaveCount(1);
          await expect(markedCanvas).toBeHidden();
          await openBenchmarkSession(desktop, 0);
          await expect(markedCanvas).toBeVisible();
        }

        await expect(desktop.page.getByRole("textbox", { name: "Terminal input" })).toHaveCount(1);
        await sendShellCommand(terminal.input, `touch ${quoteShellPath(paths.switchedResponsive)}`);
        await waitForPath(paths.switchedResponsive);

        if (processObservation.kind === "observed") {
          const tree = await readProcessTree(desktop.processId);
          expect(tree.some((candidate) => candidate.pid === processObservation.pid)).toBe(true);
          expect(
            tree.filter((candidate) => candidate.command === processObservation.command).length,
          ).toBe(processObservation.matchingProcessCount);
        }
      });

      const settleEnergy = await measureSettledDesktop(desktop);

      expect(desktop.pageErrors).toEqual([]);
      report(
        {
          action: { durationMs: action.durationMs, processEnergy: action.processes },
          postSettle: { processEnergy: settleEnergy },
        },
        {
          fixture: desktop.fixture.metadata,
          outputLineCount: OUTPUT_LINE_COUNT,
          tabSwitchCycles: TAB_SWITCH_CYCLES,
          terminalProcessObserved: processObservation.kind === "observed",
        },
      );
    } finally {
      await desktop.close();
    }
  },
);
