import { expect, test } from "vitest";
import type { Message } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { recallStep, recentPrompts } from "./composer-history.ts";

function userMessage(
  id: string,
  source: Extract<Message, { readonly kind: "user" }>["source"] = { kind: "user" },
): Message {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">(`turn-${id}`),
    at: 1,
    kind: "user",
    content: id,
    source,
    delivery: "queue",
    status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

test("the history holds the chat's last ten prompts the user wrote, newest first", () => {
  const prompts = Array.from({ length: 12 }, (_, index) => userMessage(`prompt ${String(index)}`));

  expect(
    recentPrompts([
      ...prompts,
      userMessage("a command", { kind: "action", label: "Compact" }),
      userMessage("a shell line", { kind: "shell" }),
    ]),
  ).toEqual(Array.from({ length: 10 }, (_, index) => `prompt ${String(11 - index)}`));
});

test("Up walks to older prompts and stops at the oldest; Down walks back to the draft", () => {
  const walk = (directions: readonly ("older" | "newer")[]) =>
    directions.reduce<number | undefined>(
      (position, direction) => recallStep(3, position, direction),
      undefined,
    );

  expect(walk(["older"])).toBe(0);
  expect(walk(["older", "older", "older", "older"])).toBe(2);
  expect(walk(["older", "older", "newer"])).toBe(0);
  expect(walk(["older", "newer"])).toBeUndefined();
  expect(walk(["newer"])).toBeUndefined();
  expect(recallStep(0, undefined, "older")).toBeUndefined();
});
