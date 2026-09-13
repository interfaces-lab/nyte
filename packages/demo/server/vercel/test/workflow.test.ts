import type { sleep } from "workflow";
import type { advanceSession } from "../src/advance.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSession } from "../workflows/session.ts";

type AdvanceOutcome = Awaited<ReturnType<typeof advanceSession>>;

const { advance, durableSleep } = vi.hoisted(() => ({
  advance: vi.fn<typeof advanceSession>(),
  durableSleep: vi.fn<typeof sleep>(),
}));

vi.mock("../src/advance.ts", () => ({ advanceSession: advance }));
vi.mock("workflow", () => ({ sleep: durableSleep }));

beforeEach(() => {
  advance.mockReset();
  durableSleep.mockReset();
  durableSleep.mockResolvedValue(undefined);
});

describe("durable session dispatch", () => {
  it("finishes without polling when a call needs an undated reply", async () => {
    advance.mockResolvedValue({ kind: "waiting" });

    await runSession("session-a", "main");

    expect(advance).toHaveBeenCalledExactlyOnceWith("session-a", "main");
    expect(durableSleep).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "retry", at: 1000 },
    { kind: "waiting", until: 2000 },
    { kind: "busy", until: 3000 },
    { kind: "fenced" },
  ] satisfies AdvanceOutcome[])("suspends $kind before doing more work", async (outcome) => {
    const suspended = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let finished = false;
    let resumed = false;
    durableSleep.mockImplementationOnce(async () => {
      suspended.resolve();
      await resume.promise;
      resumed = true;
    });
    advance.mockResolvedValueOnce(outcome).mockImplementationOnce(async () => {
      if (!resumed) throw new Error("Advanced while the durable wait was unresolved");
      finished = true;
      return { kind: "idle" };
    });

    const running = runSession("session-a", "main");
    await suspended.promise;
    expect(finished).toBe(false);
    // Vitest records only the last overload; sleep also accepts a Date.
    const duration: unknown = durableSleep.mock.calls[0]?.[0];
    if (outcome.kind !== "fenced") {
      const deadline = outcome.kind === "retry" ? outcome.at : outcome.until;
      expect(duration).toBeInstanceOf(Date);
      if (!(duration instanceof Date)) throw new Error("Expected a durable deadline");
      expect(duration.getTime()).toBeGreaterThanOrEqual(deadline);
    } else {
      expect(duration).toBeDefined();
    }
    resume.resolve();
    await running;
    expect(finished).toBe(true);
  });
});
