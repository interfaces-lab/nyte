import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import { describe, expect, test } from "vitest";
import { createUpdateController } from "./update-controller.ts";
import type { DesktopUpdateActivity } from "./host.ts";

function setup() {
  let activity: DesktopUpdateActivity = { kind: "idle" };
  let download = async (): Promise<string[]> => ["verified.zip"];
  const states: UpdateState[] = [];
  let installs = 0;

  const info = {
    version: "0.0.3",
    files: [],
    path: "Nyte.zip",
    sha512: "test",
    releaseDate: "2026-09-04",
  };

  const controller = createUpdateController({
    updater: {
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: info,
        versionInfo: info,
      }),
      downloadUpdate: () => download(),
      quitAndInstall: () => {
        installs++;
      },
    },
    activity: async () => activity,
    publish: (state) => {
      states.push(state);
    },
    logError: () => undefined,
  });

  return {
    controller,
    states,
    installs: () => installs,
    setActivity: (next: DesktopUpdateActivity) => {
      activity = next;
    },
    setDownload: (next: () => Promise<string[]>) => {
      download = next;
    },
  };
}

describe("desktop updates", () => {
  test("publishes each step from check to install, and a failed download is retried by the next check", async () => {
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
    expect(harness.installs()).toBe(0);
    await harness.controller.restart();

    expect(harness.states).toEqual([
      { kind: "downloading", version: "0.0.3", percent: 0 },
      { kind: "failed", version: "0.0.3", message: "checksum mismatch" },
      { kind: "downloading", version: "0.0.3", percent: 0 },
      { kind: "downloading", version: "0.0.3", percent: 42 },
      { kind: "ready", version: "0.0.3" },
    ]);
    expect(harness.installs()).toBe(1);
  });

  test("a restart over running work publishes blocked, and a second restart installs anyway", async () => {
    const harness = setup();
    await harness.controller.check();
    harness.setActivity({ kind: "busy", taskCount: 2, terminalCommandCount: 1 });

    await harness.controller.restart();
    expect(harness.states.at(-1)).toEqual({
      kind: "blocked",
      version: "0.0.3",
      taskCount: 2,
      terminalCommandCount: 1,
    });
    expect(harness.installs()).toBe(0);

    await harness.controller.restart();
    expect(harness.installs()).toBe(1);
  });
});
