import assert from "node:assert/strict";
import { sessionId } from "@nyte-ai/core";
import { test } from "vitest";
import { advanceNyte } from "../src/index.ts";

test("a failed advance still closes its execution resources", async () => {
  let closed = false;
  await assert.rejects(
    advanceNyte({
      input: { sessionId: sessionId("a") },
      openExecution: async () => ({
        advance: async () => {
          throw new Error("failed advance");
        },
        close: async () => {
          closed = true;
        },
      }),
    }),
    /failed advance/,
  );
  assert.equal(closed, true);
});
