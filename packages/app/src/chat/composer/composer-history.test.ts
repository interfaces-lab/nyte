import { expect, test } from "vitest";
import type { Message } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { endedTurn } from "../../../test/view-fixtures.ts";
import { loadedPrompts, readPrompts, recallStep } from "./composer-history.ts";

type UserMessage = Extract<Message, { readonly kind: "user" }>;

function userMessage(id: string, source: UserMessage["source"] = { kind: "user" }): UserMessage {
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

function steer(id: string, prompt: UserMessage): UserMessage {
  return { ...userMessage(id), turn: prompt.turn, delivery: "steer" };
}

/** The turns the messages lead; a steer joins its prompt's turn instead. */
function turnsFor(messages: readonly UserMessage[]) {
  return messages.flatMap((message) =>
    message.delivery === "steer"
      ? []
      : [endedTurn([], { id: message.turn, prompt: message.id }).info],
  );
}

test("the history holds the chat's last ten prompts the user wrote, newest first", () => {
  const prompts = Array.from({ length: 12 }, (_, index) => userMessage(`prompt ${String(index)}`));

  const messages = [
    ...prompts,
    userMessage("a command", { kind: "action", label: "Compact" }),
    userMessage("a shell line", { kind: "shell" }),
  ];

  expect(
    loadedPrompts({ leadingPrompt: null, messages, turns: turnsFor(messages) }).prompts,
  ).toEqual(Array.from({ length: 10 }, (_, index) => `prompt ${String(11 - index)}`));
});

test("recall leaves steers out, in loaded turns and in turns read from the host", async () => {
  const older = userMessage("older");
  const first = userMessage("first");
  const second = userMessage("second");
  const loaded = [steer("steer in first", first), second, steer("steer in second", second)];
  const page = [older, steer("steer in older", older)];

  const history = loadedPrompts({
    leadingPrompt: first,
    messages: loaded,
    turns: turnsFor([first, ...loaded]),
  });

  expect(history.prompts).toEqual(["second", "first"]);

  const head = {
    history: async () => ({ messages: page, leadingPrompt: null, turns: turnsFor(page) }),
  };

  expect((await readPrompts(head, history, 3)).prompts).toEqual(["second", "first", "older"]);
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
