import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import type { MessageBoxOptions } from "electron";
import { describe, expect, test } from "vitest";
import { createUpdateController } from "./update-controller.ts";
import type { DesktopUpdateActivity } from "./host.ts";

function setup({
  available = true,
  cleanup = async () => undefined,
}: { available?: boolean; cleanup?: () => Promise<void> } = {}) {
  let activity: DesktopUpdateActivity = { kind: "idle" };
  let download = async (): Promise<string[]> => ["verified.zip"];
  let response = 0;
  const states: UpdateState[] = [];
  const dialogs: MessageBoxOptions[] = [];
  const events: string[] = [];
  const logs: string[] = [];
  let checks = 0;

  const info = {
    version: "0.0.3",
    files: [],
    path: "Nyte.zip",
    sha512: "test",
    releaseDate: "2026-09-04",
  };

  const controller = createUpdateController({
    updater: {
      checkForUpdates: async () => {
        checks++;

        return { isUpdateAvailable: available, updateInfo: info, versionInfo: info };
      },
      downloadUpdate: () => download(),
      quitAndInstall: () => {
        events.push("install");
      },
    },
    currentVersion: "0.0.2",
    activity: async () => activity,
    beforeInstall: async () => {
      events.push("cleanup");
      await cleanup();
    },
    cleanupTimeoutMs: 5,
    publish: (state) => {
      states.push(state);
    },
    message: async (options) => {
      dialogs.push(options);

      return { response };
    },
    log: (event) => {
      logs.push(event);
    },
  });

  return {
    controller,
    states,
    dialogs,
    events,
    logs,
    checks: () => checks,
    setActivity: (next: DesktopUpdateActivity) => {
      activity = next;
    },
    setDownload: (next: () => Promise<string[]>) => {
      download = next;
    },
    setResponse: (next: number) => {
      response = next;
    },
  };
}

describe("desktop updates", () => {
  test("a background check downloads silently, and a failed download is retried by the next check", async () => {
    const harness = setup();
    harness.setDownload(async () => {
      throw new Error("checksum mismatch");
    });
    await harness.controller.check();
    harness.setDownload(async () => {
      harness.controller.progress(42);

      return ["verified.zip"];
    });
    await harness.controller.check();

    expect(harness.states).toEqual([
      { kind: "downloading", version: "0.0.3", percent: 0 },
      { kind: "failed", version: "0.0.3", message: "checksum mismatch" },
      { kind: "downloading", version: "0.0.3", percent: 0 },
      { kind: "downloading", version: "0.0.3", percent: 42 },
      { kind: "ready", version: "0.0.3" },
    ]);
    expect(harness.dialogs).toEqual([]);
    expect(harness.events).toEqual([]);
  });

  test("a click with no release says Nyte is up to date", async () => {
    const harness = setup({ available: false });
    await harness.controller.click();

    expect(harness.dialogs).toMatchObject([{ message: "Nyte 0.0.2 is up to date" }]);
  });

  test("a click shares a running check, then offers the restart and cleans up before installing", async () => {
    const harness = setup();
    await Promise.all([harness.controller.check(), harness.controller.click()]);

    expect(harness.checks()).toBe(1);
    expect(harness.dialogs).toMatchObject([
      {
        message: "Nyte 0.0.3 is ready to install",
        buttons: ["Restart to Update", "Later"],
        defaultId: 0,
      },
    ]);
    expect(harness.events).toEqual(["cleanup", "install"]);
  });

  test("running work turns the restart into a warning that defaults to Later", async () => {
    const harness = setup();
    await harness.controller.check();
    harness.setActivity({ kind: "busy", taskCount: 2, terminalCommandCount: 1 });
    harness.setResponse(1);
    await harness.controller.click();

    expect(harness.checks()).toBe(1);
    expect(harness.dialogs).toMatchObject([
      {
        type: "warning",
        detail: "Restarting stops 2 running tasks and 1 terminal command.",
        defaultId: 1,
      },
    ]);
    expect(harness.events).toEqual([]);
  });

  test("a second click while installing neither asks again nor installs twice", async () => {
    let cleaning = (): void => undefined;

    const cleanupStarted = new Promise<void>((resolve) => {
      cleaning = resolve;
    });

    const harness = setup({
      cleanup: () => {
        cleaning();

        return new Promise(() => undefined);
      },
    });

    await harness.controller.check();
    const first = harness.controller.click();
    await cleanupStarted;
    await harness.controller.click();
    await first;

    expect(harness.dialogs).toHaveLength(1);
    expect(harness.states.at(-1)).toEqual({ kind: "installing", version: "0.0.3" });
    expect(harness.events).toEqual(["cleanup", "install"]);
    expect(harness.logs).toContain("relaunch-cleanup-timed-out");
  });

  test("a failed cleanup still installs", async () => {
    const harness = setup({ cleanup: () => Promise.reject(new Error("close failed")) });
    await harness.controller.check();
    await harness.controller.click();

    expect(harness.events).toEqual(["cleanup", "install"]);
    expect(harness.logs).toContain("relaunch-cleanup-failed");
  });
});
