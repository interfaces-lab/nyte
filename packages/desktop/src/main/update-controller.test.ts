import { describe, expect, test } from "vitest";
import { createUpdateController, type UpdateDependencies } from "./update-controller.ts";

function setup(responses: number[] = [0, 1]) {
  const messages: string[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  let checks = 0;
  let downloads = 0;
  let installs = 0;
  const info = {
    version: "0.0.3",
    files: [],
    path: "Nyte.zip",
    sha512: "test",
    releaseDate: "2026-09-04",
  };
  const dependencies: UpdateDependencies = {
    updater: {
      checkForUpdates: async () => {
        checks++;
        return { isUpdateAvailable: true, updateInfo: info, versionInfo: info };
      },
      downloadUpdate: async () => {
        downloads++;
        return ["verified.zip"];
      },
      quitAndInstall: () => {
        installs++;
      },
    },
    message: async (options) => {
      messages.push(options.message);
      return { response: responses.shift() ?? 1, checkboxChecked: false };
    },
    status: (label) => {
      statuses.push(label);
    },
    logError: (message) => {
      errors.push(message);
    },
    version: "0.0.2",
    unavailable: undefined,
  };
  return {
    dependencies,
    messages,
    statuses,
    errors,
    counts: () => ({ checks, downloads, installs }),
  };
}

describe("desktop updates", () => {
  test("does not download until accepted, and does not restart when deferred", async () => {
    const harness = setup([1]);
    await createUpdateController(harness.dependencies).check(true);
    expect(harness.counts()).toEqual({ checks: 1, downloads: 0, installs: 0 });
    expect(harness.statuses.at(-1)).toBe("Check for Updates…");
  });

  test("retains a verified download for an explicit later restart", async () => {
    const harness = setup([0, 1, 0]);
    const controller = createUpdateController(harness.dependencies);
    await controller.check(true);
    expect(harness.counts()).toEqual({ checks: 1, downloads: 1, installs: 0 });
    expect(harness.statuses.at(-1)).toBe("Restart to Update…");
    await controller.check(true);
    expect(harness.counts()).toEqual({ checks: 1, downloads: 1, installs: 1 });
  });

  test("serializes simultaneous checks and prompts", async () => {
    const harness = setup();
    const controller = createUpdateController(harness.dependencies);
    await Promise.all([controller.check(true), controller.check(true), controller.check(false)]);
    expect(harness.counts().checks).toBe(1);
    expect(harness.counts().downloads).toBe(1);
  });

  test("never installs a failed checksum download and lets the user retry", async () => {
    const harness = setup([0]);
    harness.dependencies.updater.downloadUpdate = async () => {
      throw new Error("checksum mismatch");
    };
    const controller = createUpdateController(harness.dependencies);
    await controller.check(false);
    expect(harness.counts().installs).toBe(0);
    expect(harness.messages.at(-1)).toBe("Couldn't update Nyte");
    expect(harness.statuses.at(-1)).toBe("Check for Updates…");
    expect(harness.errors).toEqual(["checksum mismatch"]);
  });

  test("background network failures stay quiet; manual failures are shown", async () => {
    const harness = setup();
    harness.dependencies.updater.checkForUpdates = async () => {
      throw new Error("No published releases");
    };
    const controller = createUpdateController(harness.dependencies);
    await controller.check(false);
    expect(harness.messages).toEqual([]);
    await controller.check(true);
    expect(harness.messages).toEqual(["Couldn't update Nyte"]);
  });

  test("source or offline mode never reaches the update transport", async () => {
    const harness = setup();
    harness.dependencies.unavailable = "Development build";
    const controller = createUpdateController(harness.dependencies);
    await controller.check(false);
    await controller.check(true);
    expect(harness.counts()).toEqual({ checks: 0, downloads: 0, installs: 0 });
    expect(harness.messages).toEqual(["Updates unavailable"]);
  });

  test("only manual checks show that the current release is up to date", async () => {
    const harness = setup();
    const info = {
      version: "0.0.2",
      files: [],
      path: "Nyte.zip",
      sha512: "test",
      releaseDate: "2026-09-04",
    };
    harness.dependencies.updater.checkForUpdates = async () => ({
      isUpdateAvailable: false,
      updateInfo: info,
      versionInfo: info,
    });
    const controller = createUpdateController(harness.dependencies);
    await controller.check(false);
    expect(harness.messages).toEqual([]);
    await controller.check(true);
    expect(harness.messages).toEqual(["You're up to date"]);
    expect(harness.counts().downloads).toBe(0);
  });
});
