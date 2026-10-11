import assert from "node:assert/strict";
import { test } from "vitest";
import type { PartView, SessionView } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { answerQuestion, waitingQuestions } from "./questions-state.ts";
import { installConnection } from "../../sdk.tsx";
import { scriptedConnection } from "../../../test/scripted-connection.ts";

function part(id: string, change: Partial<PartView> = {}): PartView {
  return {
    id: asId<"part">(id),
    partKind: "ask/question",
    placement: { kind: "modal" },
    state: { prompt: `Pick for ${id}`, options: ["Yes", "No"] },
    version: 1,
    status: { kind: "live", run: asId<"run">("run") },
    owner: "question",
    ...change,
  };
}

function view(parts: readonly PartView[]): Pick<SessionView, "parts"> {
  return { parts };
}

test("every unanswered question part is waiting; answered, foreign and malformed parts are not", () => {
  const questions = waitingQuestions(
    view([
      part("open"),
      part("answered", { status: { kind: "settled", commit: asId<"commit">("c"), endedAt: 1 } }),
      part("map", { partKind: "maps/places" }),
      part("broken", { state: { prompt: 1 } }),
    ]),
  );

  assert.deepEqual(questions, [
    { part: asId<"part">("open"), prompt: "Pick for open", options: ["Yes", "No"] },
  ]);
  assert.deepEqual(waitingQuestions(undefined), []);
});

test("an answer is the part's answer action with the choice trimmed", async () => {
  const acted: { readonly action: string; readonly input: unknown }[] = [];
  const session = asId<"session">("chat");
  const { connection } = scriptedConnection({
    session: () => ({
      part: (id) => ({
        id,
        update: async () => ({ kind: "missing" }),
        act: async (action, input) => {
          acted.push({ action, input });

          return { kind: "ok", output: undefined };
        },
        answer: async () => null,
        close: async () => undefined,
      }),
    }),
  });
  installConnection(connection);
  const [question] = waitingQuestions(view([part("open")]));
  assert.ok(question !== undefined);

  await answerQuestion(session, question, "  Yes  ");
  assert.deepEqual(acted, [{ action: "answer", input: { choice: "Yes" } }]);
});

test("a question nobody waits on any more says so", async () => {
  const { connection } = scriptedConnection({
    session: () => ({
      part: (id) => ({
        id,
        update: async () => ({ kind: "missing" }),
        act: async () => ({ kind: "closed" }),
        answer: async () => null,
        close: async () => undefined,
      }),
    }),
  });
  installConnection(connection);
  const [question] = waitingQuestions(view([part("open")]));
  assert.ok(question !== undefined);

  await assert.rejects(
    answerQuestion(asId<"session">("chat"), question, "No"),
    /no longer waiting/,
  );
});
