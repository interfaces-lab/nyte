import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { sessionRow } from "../../test/view-fixtures.ts";
import { subagentTrayState } from "./agent-status.ts";
import { listSubagents } from "./tray/agents.tsx";

test("the agents tray tells a failed agent from a completed one and lists neither as active", () => {
  const completed = sessionRow("completed");

  const failed = sessionRow(
    "failed",
    {},
    {
      kind: "idle",
      lastRun: {
        id: asId<"run">("run"),
        end: { kind: "failed", failure: { class: "provider", message: "Rate limited." } },
        endedAt: 2,
      },
    },
  );

  expect(subagentTrayState(completed)).toBe("completed");
  expect(subagentTrayState(failed)).toBe("failed");

  expect(
    listSubagents([completed, failed], { kind: "list", retainedSessionId: failed.id }),
  ).toEqual({ active: [], listed: [failed] });
});
