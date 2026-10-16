import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { defineRenderer } from "@nyte-ai/plugin/client";
import type { Plugin, Renderer } from "@nyte-ai/plugin/client";
import { question } from "../schema.ts";
import type { QuestionAnswers, QuestionState } from "../schema.ts";

const unreadable = (kind: string): ReactNode => (
  <div data-part={kind}>This {kind} part cannot be shown.</div>
);

function QuestionForm({
  questions,
  act,
}: {
  readonly questions: QuestionState["questions"];
  readonly act: Parameters<Renderer["render"]>[1];
}): ReactNode {
  const id = useId();
  const [selected, setSelected] = useState<QuestionAnswers>(() => questions.map(() => []));
  const [custom, setCustom] = useState(() => questions.map(() => ""));

  const [status, setStatus] = useState<
    { kind: "editing" | "sending" | "sent" } | { kind: "failed"; message: string }
  >({ kind: "editing" });

  const submitting = useRef(false);
  const blocked = status.kind === "sending" || status.kind === "sent";

  const submit = async () => {
    if (blocked || submitting.current) return;
    submitting.current = true;
    setStatus({ kind: "sending" });

    const answers = questions.map((item, index) => {
      const typed = custom[index].trim();
      const choices = selected[index];

      if (typed === "" || choices.includes(typed)) return choices;

      return item.multiple ? [...choices, typed] : [typed];
    });

    try {
      const outcome = await act("answer", { answers });
      setStatus(
        outcome.kind === "ok"
          ? { kind: "sent" }
          : {
              kind: "failed",
              message:
                outcome.kind === "rejected"
                  ? outcome.reason
                  : "These questions are no longer waiting.",
            },
      );
    } catch {
      setStatus({ kind: "failed", message: "Couldn't send your answers. Try again." });
    }

    submitting.current = false;
  };

  return (
    <form
      data-part="ask/question"
      aria-label="Questions"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {questions.map((item, index) => (
        <fieldset key={index} disabled={blocked}>
          <legend>{item.header}</legend>
          <p>{item.question}</p>
          {item.options.map((option) => (
            <label key={option.label}>
              <input
                type={item.multiple ? "checkbox" : "radio"}
                name={`${id}-${index}`}
                value={option.label}
                checked={selected[index].includes(option.label)}
                onChange={() => {
                  setSelected((current) =>
                    current.map((choices, position) => {
                      if (position !== index) return choices;

                      if (!item.multiple) return [option.label];

                      return choices.includes(option.label)
                        ? choices.filter((choice) => choice !== option.label)
                        : [...choices, option.label];
                    }),
                  );

                  if (!item.multiple)
                    setCustom((current) =>
                      current.map((typed, position) => (position === index ? "" : typed)),
                    );
                }}
              />
              <span>{option.label}</span>
              <span>{option.description}</span>
            </label>
          ))}
          <label>
            Type your own answer
            <textarea
              value={custom[index]}
              onChange={({ currentTarget }) => {
                const typed = currentTarget.value;
                setCustom((current) =>
                  current.map((value, position) => (position === index ? typed : value)),
                );

                if (!item.multiple && typed.trim() !== "")
                  setSelected((current) =>
                    current.map((choices, position) => (position === index ? [] : choices)),
                  );
              }}
            />
          </label>
        </fieldset>
      ))}
      <button type="submit" disabled={blocked}>
        {status.kind === "sending" ? "Sending answers…" : "Submit answers"}
      </button>
      {status.kind === "failed" && <p role="alert">{status.message}</p>}
      {status.kind === "sent" && <p role="status">Answers sent.</p>}
    </form>
  );
}

export const questionRenderers: readonly Renderer[] = [
  defineRenderer(
    question,
    "react",
    (state, act) => {
      const answers = state.answers;

      if (answers !== null)
        return (
          <div data-part="ask/question" aria-label="Answers">
            {state.questions.map((item, index) => (
              <section key={index}>
                <h3>{item.header}</h3>
                <p>{item.question}</p>
                <p>Answer: {answers[index].join(", ") || "Unanswered"}</p>
              </section>
            ))}
          </div>
        );

      return (
        <QuestionForm key={JSON.stringify(state.questions)} questions={state.questions} act={act} />
      );
    },
    unreadable,
  ),
];

export default { id: "questions", contribute: { renderers: questionRenderers } } satisfies Plugin;
