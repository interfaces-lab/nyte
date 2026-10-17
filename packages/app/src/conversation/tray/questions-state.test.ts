import assert from "node:assert/strict";
import { test } from "vitest";
import type { PartView, SessionView } from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { asId } from "@nyte-ai/schema";
import { answerQuestion } from "./questions-state.ts";
import { installConnection } from "../../sdk.tsx";
import { scriptedConnection } from "../../../test/scripted-connection.ts";

function part(id: string, change: Partial<PartView> = {}): PartView {
  return {
    id: asId<"part">(id),
    partKind: "ask/question",
    placement: { kind: "modal" },
    state: {
      questions: [
        {
          header: "Pick",
          question: `Pick for ${id}`,
          options: [
            { label: "Yes", description: "Proceed." },
            { label: "No", description: "Stop." },
          ],
        },
      ],
      answers: null,
    },
    version: 1,
    status: { kind: "live", run: asId<"run">("run") },
    owner: "question",
    ...change,
  };
}

function view(parts: readonly PartView[]): Pick<SessionView, "parts"> {
  return { parts };
}

test("every unanswered question part is waiting; answered, stopped, foreign and malformed parts are not", () => {
  const questions = openQuestions(
    view([
      part("open"),
      part("answered", {
        state: {
          questions: [
            {
              header: "Pick",
              question: "Pick",
              options: [{ label: "Yes", description: "Proceed." }],
            },
          ],
          answers: [["Yes"]],
        },
      }),
      part("stopped", {
        status: {
          kind: "failed",
          run: asId<"run">("run"),
          failure: { class: "aborted", message: "Stopped." },
        },
      }),
      part("map", { partKind: "maps/places" }),
      part("broken", { state: { prompt: 1 } }),
    ]),
  );

  assert.deepEqual(questions, [
    {
      part: asId<"part">("open"),
      questions: [
        {
          header: "Pick",
          question: "Pick for open",
          options: [
            { label: "Yes", description: "Proceed." },
            { label: "No", description: "Stop." },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(openQuestions(undefined), []);
});

test("all answers go to the question part in one action", async () => {
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
  const [question] = openQuestions(view([part("open")]));
  assert.ok(question !== undefined);

  await answerQuestion(session, question, [["Yes"]]);
  assert.deepEqual(acted, [{ action: "answer", input: { answers: [["Yes"]] } }]);
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
  const [question] = openQuestions(view([part("open")]));
  assert.ok(question !== undefined);

  await assert.rejects(
    answerQuestion(asId<"session">("chat"), question, [["No"]]),
    /no longer waiting/,
  );
});
