import { strict as assert } from "node:assert";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { ToolClass } from "@nyte-ai/protocol";
import { delegateTitle, indexDelegateNames } from "../src/chat/delegate-names.ts";

test("a delegate line uses the child name once its session row is listed", () => {
  const child = sessionId("child");
  const toolClass = {
    kind: "delegate",
    role: "send",
    target: { kind: "one", session: child },
  } satisfies Extract<ToolClass, { readonly kind: "delegate" }>;

  assert.equal(delegateTitle(toolClass, true, indexDelegateNames([])), `Sent to ${child}`);
  assert.equal(
    delegateTitle(
      toolClass,
      true,
      indexDelegateNames([{ sessionId: child, name: "Research agent" }]),
    ),
    "Sent to Research agent",
  );
});
