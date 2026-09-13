import { sessionId } from "@nyte-ai/core";
import type { start } from "workflow/api";
import { beforeEach, expect, it, vi } from "vitest";
import { wakeSession } from "../src/dispatch.ts";
import type { openExecution } from "../src/runtime.ts";
import { postgresFixture } from "../fixtures/postgres.ts";

const { openSdk, startWorkflow } = vi.hoisted(() => ({
  openSdk: vi.fn<typeof openExecution>(),
  startWorkflow: vi.fn<typeof start>(),
}));

vi.mock("../src/runtime.ts", () => ({ openExecution: openSdk }));
vi.mock("workflow/api", () => ({ start: startWorkflow }));

beforeEach(() => {
  openSdk.mockReset();
  startWorkflow.mockReset();
});

it("dispatches an explicitly addressed branch", async () => {
  await wakeSession({ sessionId: sessionId("session-a"), head: "review" });

  expect(startWorkflow.mock.calls.map((call) => call[1])).toEqual([["session-a", "review"]]);
});

it("wakes every saved head when a reply identifies its run without a head", async (context) => {
  const fixture = await postgresFixture();
  context.onTestFinished(() => fixture.close());
  const sdk = await fixture.openSdk();
  const created = await sdk.sessions.create({ name: "Remote branches" });
  await sdk.heads.create({
    sessionId: created.sessionId,
    head: "review",
    from: { head: "main" },
  });
  openSdk.mockResolvedValue(sdk);

  await wakeSession({ sessionId: created.sessionId });

  const dispatched = startWorkflow.mock.calls.map((call) => call[1]);
  expect(dispatched).toHaveLength(2);
  expect(dispatched).toEqual(
    expect.arrayContaining([
      [created.sessionId, "main"],
      [created.sessionId, "review"],
    ]),
  );
});
