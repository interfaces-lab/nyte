import { assert, describe, expect, it } from "vitest";
import { driveInProcess } from "../src/drive/execution.ts";
import { until } from "../src/harness.ts";
import { world } from "./fake-env.ts";

describe("workspace git", () => {
  it("refuses a branch switch as busy while a run in the workspace is live, and switches once it ends", async () => {
    const { kernel, host, workspace } = await world({ execution: { kind: "admit-only" } });
    const driver = driveInProcess(kernel, { kind: "workspace", workspace });
    const { session } = await host.sessions.start({ workspace, content: "Hi." });

    const live = await until(async () => {
      const execution = (await session.view()).execution;

      return execution.kind === "live" ? execution.run.id : undefined;
    });

    const git = await host.workspace(workspace).git();

    assert(git.kind === "available");
    expect(await git.api.checkout({ name: "feature" })).toEqual({ kind: "busy", runs: [live] });
    expect(await git.api.branch({ name: "feature", checkout: true })).toEqual({
      kind: "busy",
      runs: [live],
    });
    expect(await git.api.branch({ name: "feature", checkout: false })).toMatchObject({
      kind: "applied",
    });

    await session.stop();
    await until(async () => ((await session.view()).execution.kind === "idle" ? true : undefined));
    await driver.close();

    expect(await git.api.checkout({ name: "feature" })).toMatchObject({ kind: "applied" });
    expect(await git.api.branch({ name: "next", checkout: true })).toMatchObject({
      kind: "applied",
    });
  });
});
