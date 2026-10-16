import type { MoveOptions } from "@nyte-ai/sdk";
import { canStopTask } from "../../lib/tasks.ts";
import { draftFromContent, snapshot } from "../draft.ts";
import type { Outcome } from "../msg.ts";
import type { QuestionModel } from "../question.ts";
import {
  collectQuestionAnswers,
  createQuestionDraft,
  readQuestionDraft,
  sameQuestion,
  selectQuestionAnswer,
  storeQuestionDraft,
} from "../question.ts";
import { runModel, tableInputFor } from "../screen.ts";
import type { QuestionTypedDraft, State } from "../state.ts";
import { andThen, busy, clearDraft, refuse, stay, withLocal, withNotice } from "../step.ts";
import type { SomeHandlers, Step } from "../step.ts";
import { openDialog } from "./dialogs.ts";
import { stageHandback } from "./facts.ts";

const ESCAPE_WINDOW_MS = 500;

const MOVE_REFUSALS = {
  busy: "Wait for the current run",
  "pending-input": "Send or remove the queued messages first",
  stale: "The chat moved on while the tree was open; try again",
  "missing-target": "Commit not found",
} as const;

export const runHandlers = {
  "stop-run": (state, _msg, now) => {
    const followed = state.facts.session;
    const current = runModel(followed);

    if (followed === null || current.kind === "idle")
      return refuse(state, "No active run to stop.", now, "info");

    return { state, effects: [{ kind: "stop-run", session: followed.id, run: current.run }] };
  },
  answer: (state, msg) => {
    const followed = state.facts.session;
    const question = tableInputFor(state, null).question;

    if (question === null || question.part !== msg.part || question.session !== msg.session)
      return stay(state);

    const group =
      readQuestionDraft(state.local.question, question) ?? createQuestionDraft(question.questions);

    if (group.phase !== "editing") return stay(state);

    const value = msg.value.trim();

    const field = group.fields[question.index];

    if (value === "" || field === undefined) return stay(state);

    const selected = selectQuestionAnswer(field, value, msg.typed);

    const next = withLocal(state, {
      question: storeQuestionDraft(state.local.question, question, {
        ...group,
        fields: group.fields.map((current, index) =>
          index === question.index ? selected : current,
        ),
      }),
    });

    if (!msg.typed && selected.kind === "multiple") return stay(next);

    const typed =
      msg.typed && followed !== null
        ? { session: followed.id, draft: snapshot(state.local.draft) }
        : null;

    return msg.typed
      ? andThen(clearDraft(next), (current) => advanceQuestion(current, question, typed))
      : advanceQuestion(next, question, null);
  },
  "open-question": (state) =>
    stay(
      withLocal(state, {
        question: { ...state.local.question, dismissed: null, highlighted: 0 },
      }),
    ),
  "escape-tree": (state, _msg, now, reduce) => {
    const armed = state.local.escapeArmedAt;

    if (armed === null || now - armed > ESCAPE_WINDOW_MS)
      return stay(withLocal(state, { escapeArmedAt: now }));

    return openDialog(
      withLocal(state, { escapeArmedAt: null }),
      { kind: "tree", filter: "default" },
      now,
      reduce,
    );
  },
  "move-to": (state, msg, now) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    if (busy(state))
      return refuse(state, "Wait for the current run before changing the session branch", now);

    const landed = followed.view?.messages.find(
      (message) =>
        message.kind === "user" &&
        message.status.kind === "landed" &&
        message.status.commit === msg.commit,
    );

    const options: MoveOptions = {
      running: "refuse",
      abandoned:
        msg.abandoned === "keep"
          ? "keep"
          : {
              summarize:
                msg.abandoned.summarize.instructions === null
                  ? {}
                  : { instructions: msg.abandoned.summarize.instructions },
            },
      expect: msg.expect,
    };

    return {
      state: withLocal(state, { move: { purpose: "tree", message: landed?.id ?? null } }),
      effects: [
        {
          kind: "move",
          session: followed.id,
          position: { kind: "commit", id: msg.commit },
          options,
          handback: null,
        },
      ],
    };
  },
  "stop-task": (state, msg, now) => {
    const followed = state.facts.session;
    const task = state.facts.tasks.find((candidate) => candidate.id === msg.task);

    if (followed === null || task === undefined)
      return refuse(state, "This task is no longer available.", now, "info");

    if (task.kind === "job" && task.job.state.kind !== "running")
      return refuse(state, "This task has already finished. /tasks opens its output.", now, "info");

    if (!canStopTask(task)) return refuse(state, "This task has already finished.", now, "info");

    return {
      state: withNotice(state, "Cancellation requested.", "info", now),
      effects: [
        {
          kind: "stop-task",
          session: followed.id,
          task:
            task.kind === "agent"
              ? { kind: "agent", session: task.id }
              : { kind: "job", job: task.id },
        },
      ],
    };
  },
  "step-task": (state, msg) => {
    const stack = state.local.dialogs.map((dialog) => {
      if (dialog.kind !== "inspector" || dialog.id !== msg.dialog) return dialog;
      const tasks = state.facts.tasks;
      const index = tasks.findIndex((task) => task.id === dialog.task);
      const next = tasks[index + msg.direction];

      return next === undefined
        ? dialog
        : { ...dialog, task: next.id, following: true, scroll: null };
    });

    return stay(withLocal(state, { dialogs: stack }));
  },
  answered: (state, msg, now) => {
    const local = state.local.question;

    const group = readQuestionDraft(local, msg.request);

    if (group?.phase !== "submitting") return stay(state);

    const accepted = msg.result.kind === "accepted";

    const active = tableInputFor(state, null).question;

    const settled = withLocal(state, {
      question: {
        ...storeQuestionDraft(local, msg.request, {
          ...group,
          phase: accepted ? "answered" : "editing",
        }),
        highlighted: accepted && sameQuestion(active, msg.request) ? 0 : local.highlighted,
        dismissed: !accepted && sameQuestion(local.dismissed, msg.request) ? null : local.dismissed,
      },
    });

    if (accepted) return stay(settled);

    const next = withNotice(
      settled,
      msg.result.kind === "failed"
        ? `Couldn't send your answers: ${msg.result.message}`
        : "That question is no longer waiting",
      "warning",
      now,
    );

    return msg.typed === null
      ? stay(next)
      : stageHandback(
          next,
          msg.typed.session,
          { draft: msg.typed.draft, notice: null, unlessLanded: null },
          now,
        );
  },
  moved: (state, msg, now) => moved(state, msg, now),
  "run-stopped": (state, msg, now) =>
    msg.result === "missing" ? refuse(state, "No active run to stop.", now, "info") : stay(state),
} satisfies SomeHandlers;

export function advanceQuestion(
  state: State,
  question: QuestionModel,
  typed: QuestionTypedDraft | null,
): Step {
  const local = state.local.question;

  const group = readQuestionDraft(local, question) ?? createQuestionDraft(question.questions);

  if (group.phase !== "editing") return stay(state);

  if (group.active < question.questions.length - 1)
    return stay(
      withLocal(state, {
        question: {
          ...storeQuestionDraft(local, question, { ...group, active: group.active + 1 }),
          dismissed: null,
          highlighted: 0,
        },
      }),
    );

  return {
    state: withLocal(state, {
      question: {
        ...storeQuestionDraft(local, question, { ...group, phase: "submitting" }),
        dismissed: { session: question.session, part: question.part },
      },
    }),
    effects: [
      {
        kind: "answer",
        session: question.session,
        part: question.part,
        answers: collectQuestionAnswers(group),
        typed,
      },
    ],
  };
}

function moved(state: State, msg: Extract<Outcome, { kind: "moved" }>, now: number): Step {
  const context = state.local.move ?? { purpose: "tree" as const, message: null };
  const next = withLocal(state, { move: null });
  const followed = state.facts.session;
  const { outcome } = msg;

  if (outcome.kind === "moved") {
    const handback = outcome.handback === null ? msg.handback : draftFromContent(outcome.handback);

    if (handback !== null && followed !== null)
      return stageHandback(
        next,
        followed.id,
        {
          draft: handback,
          notice:
            context.purpose === "retract"
              ? "Stopped. Message is back in the composer."
              : "Message moved back to the composer. Enter sends it again.",
          unlessLanded: context.message,
        },
        now,
      );

    return context.purpose === "retract"
      ? stay(next)
      : stay(withNotice(next, "Moved. The next message starts a branch here.", "ok", now));
  }

  if (context.purpose === "retract") return stay(next);

  return refuse(
    next,
    `error: ${outcome.kind === "summary-failed" ? outcome.reason : MOVE_REFUSALS[outcome.kind]}`,
    now,
    "error",
  );
}
