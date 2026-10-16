import { shortId } from "../../lib/format.ts";
import type { ListPurpose } from "../dialogs/list.ts";
import { NO_PARTS } from "../draft.ts";
import { chatCommands, interactionsFor } from "../interactions.ts";
import type { Intent } from "../msg.ts";
import {
  createQuestionDraft,
  readQuestionDraft,
  sameQuestion,
  storeQuestionDraft,
} from "../question.ts";
import { queueRows } from "../queue.ts";
import { tableInputFor } from "../screen.ts";
import { applyChoice, settingRows } from "../settings.ts";
import type { State } from "../state.ts";
import { andThen, busy, refuse, setDraft, stay, withLocal } from "../step.ts";
import type { Reduce, SomeHandlers, Step } from "../step.ts";
import { findDialog, listDialog, openDialog, withoutDialog } from "./dialogs.ts";
import { advanceQuestion } from "./run.ts";

type Choose = Extract<Intent, { readonly kind: "choose" }>;

type Purposes = { readonly [K in ListPurpose["kind"]]: Extract<ListPurpose, { readonly kind: K }> };

type Choosers = {
  readonly [K in ListPurpose["kind"]]: (
    state: State,
    purpose: Purposes[K],
    msg: Choose,
    now: number,
    reduce: Reduce,
  ) => Step;
};

export const chooseHandlers = {
  choose: (state, msg, now, reduce) => {
    const dialog = findDialog(state, msg.dialog);

    if (dialog === null || dialog.kind !== "list") return stay(state);

    return choosePurpose(dialog.purpose.kind, dialog.purpose, state, msg, now, reduce);
  },
} satisfies SomeHandlers;

function choosePurpose<K extends ListPurpose["kind"]>(
  kind: K,
  purpose: Purposes[K],
  state: State,
  msg: Choose,
  now: number,
  reduce: Reduce,
): Step {
  return CHOOSERS[kind](state, purpose, msg, now, reduce);
}

function closing(state: State, msg: Choose): State {
  return withoutDialog(state, msg.dialog);
}

const CHOOSERS: Choosers = {
  question: (state, purpose, msg, now, reduce) => {
    const choice = msg.choice;
    const question = tableInputFor(state, null).question;

    if (question === null || !sameQuestion(question, purpose)) return stay(state);

    const group =
      readQuestionDraft(state.local.question, question) ?? createQuestionDraft(question.questions);

    if (group.phase !== "editing") return stay(state);

    if (choice === "next") return advanceQuestion(state, question, null);

    if (choice === "back")
      return group.active === 0
        ? stay(state)
        : stay(
            withLocal(state, {
              question: {
                ...storeQuestionDraft(state.local.question, question, {
                  ...group,
                  active: group.active - 1,
                }),
                highlighted: 0,
              },
            }),
          );

    if (choice === "custom") {
      const field = group.fields[question.index];

      if (field === undefined) return stay(state);

      const deselect = field.kind === "multiple" && field.customSelected;

      const selected =
        field.kind === "multiple"
          ? { ...field, customSelected: !deselect }
          : { ...field, selection: { kind: "custom" as const } };

      const local = storeQuestionDraft(state.local.question, question, {
        ...group,
        fields: group.fields.map((current, index) =>
          index === question.index ? selected : current,
        ),
      });

      if (deselect) return stay(withLocal(state, { question: local }));

      const next = withLocal(state, {
        question: { ...local, dismissed: { session: question.session, part: question.part } },
      });

      const step =
        field.customText === ""
          ? stay(next)
          : setDraft(next, { text: field.customText, parts: NO_PARTS });

      return andThen(step, (current) => ({
        state: current,
        effects: [{ kind: "composer", op: { kind: "focus" } }],
      }));
    }

    const option = question.field.options.find((_, index) => `option:${index}` === choice);

    return option === undefined
      ? stay(state)
      : reduce(
          state,
          {
            kind: "answer",
            session: purpose.session,
            part: purpose.part,
            value: option.label,
            typed: false,
          },
          now,
        );
  },
  resume: (state, purpose, msg, now, reduce) => {
    const { choice } = msg;
    const closed = closing(state, msg);

    if (choice === null) return stay(state);

    if (choice === state.facts.session?.id)
      return refuse(closed, `Already in ${shortId(choice)}`, now, "info");
    const target = purpose.sessions.find((id) => id === choice);

    return target === undefined
      ? stay(closed)
      : reduce(closed, { kind: "switch-session", session: target, announce: true }, now);
  },
  palette: (state, _purpose, msg, now, reduce) => {
    const { choice } = msg;
    const closed = closing(state, msg);

    if (choice === null || choice === "cmd:help") return stay(closed);

    if (choice === "shortcuts")
      return openDialog(closed, { kind: "text", content: "shortcuts" }, now, reduce);

    if (choice === "cmd:cd") return reduce(closed, { kind: "prefill", text: "/cd " }, now);

    if (choice.startsWith("cmd:"))
      return reduce(
        closed,
        { kind: "run-command", name: choice.slice("cmd:".length), argument: "" },
        now,
      );
    const command = chatCommands().find((name) => `action:${name}` === choice);

    const intent =
      command === undefined ? null : interactionsFor(tableInputFor(closed, null))[command].intent;

    return intent === null
      ? refuse(closed, "That shortcut is no longer available.", now)
      : reduce(closed, intent, now);
  },
  skills: (state, _purpose, msg, now, reduce) =>
    msg.choice === null
      ? stay(closing(state, msg))
      : reduce(closing(state, msg), { kind: "prefill", text: `/${msg.choice} ` }, now),
  queue: (state, _purpose, msg, now, reduce) => {
    const { choice } = msg;
    const closed = closing(state, msg);

    if (choice === null) return stay(state);
    const rows = queueRows(state.facts.session, state.local.editing);
    const row = rows.find((candidate) => candidate.id === choice);

    if (row === undefined) return refuse(state, "Already sent", now);

    switch (msg.action) {
      case "chat.queue.edit":
        return reduce(closed, { kind: "edit-queued", message: row.id }, now);
      case "chat.queue.delete":
        return reduce(closed, { kind: "withdraw", message: row.id }, now);
      case "chat.queue.up":
        return reduce(state, { kind: "reorder", message: row.id, to: "earlier" }, now);
      case "chat.queue.down":
        return reduce(state, { kind: "reorder", message: row.id, to: "later" }, now);
      default:
        return reduce(closed, { kind: "promote", message: row.id }, now);
    }
  },
  settings: (state, _purpose, msg, now, reduce) => {
    const row = settingRows(state).find((candidate) => candidate.id === msg.choice);

    if (row === undefined) return stay(state);

    if (busy(state) && !row.whileBusy)
      return refuse(state, `Wait for the current run before changing ${row.label}`, now);

    if (row.id === "model") return openDialog(state, { kind: "model" }, now, reduce);

    return openDialog(
      state,
      { kind: "list", purpose: { kind: "setting", key: row.id } },
      now,
      reduce,
    );
  },
  mcp: (state, purpose, msg, now, reduce) =>
    msg.choice === null || !msg.choice.startsWith("server:")
      ? stay(state)
      : openDialog(
          state,
          {
            kind: "list",
            purpose: {
              kind: "mcp-server",
              workspace: purpose.workspace,
              server: msg.choice.slice("server:".length),
            },
          },
          now,
          reduce,
        ),
  "mcp-server": (state, purpose, msg, now, reduce) => {
    const { workspace, server } = purpose;
    const closed = closing(state, msg);
    const parent = closed.local.dialogs.at(-1);

    const done =
      parent?.kind === "list" && parent.purpose.kind === "mcp"
        ? withoutDialog(closed, parent.id)
        : closed;

    switch (msg.choice) {
      case "login":
        return reduce(done, { kind: "mcp-login", workspace, server }, now);
      case "details":
        return openDialog(state, { kind: "mcp-details", workspace, server }, now, reduce);
      case "reconnect":
      case "enable":
      case "disable":
      case "logout":
        return reduce(done, { kind: "mcp-action", workspace, server, action: msg.choice }, now);
      default:
        return stay(closed);
    }
  },
  trust: (state, purpose, msg, now, reduce) =>
    msg.choice === null
      ? stay(closing(state, msg))
      : reduce(
          closing(state, msg),
          {
            kind: "set-trust",
            workspace: purpose.workspace,
            value: msg.choice === "trust" ? true : msg.choice === "decline" ? false : null,
          },
          now,
        ),
  setting: (state, purpose, msg, now, reduce) => {
    const closed = closing(state, msg);
    const row = settingRows(state).find((candidate) => candidate.id === purpose.key);
    const option = row?.choices.find((candidate) => candidate.id === msg.choice);

    if (row === undefined || option === undefined) return stay(closed);

    return reduce(closed, applyChoice(state, row, option), now);
  },
  summary: (state, purpose, msg, now, reduce) => {
    const closed = closing(state, msg);
    const tree = closed.local.dialogs.at(-1);
    const withoutTree = tree?.kind === "tree" ? withoutDialog(closed, tree.id) : closed;

    const abandoned =
      msg.typed !== null
        ? { summarize: { instructions: msg.typed } }
        : msg.choice === "summarize"
          ? { summarize: { instructions: null } }
          : ("keep" as const);

    return reduce(
      withoutTree,
      {
        kind: "move-to",
        commit: purpose.target,
        abandoned,
        expect: purpose.revision ?? undefined,
      },
      now,
    );
  },
  tasks: (state, _purpose, msg, now, reduce) => {
    const { choice } = msg;

    if (choice === "section:finished" || choice === "section:active") {
      const closed = closing(state, msg);
      const section = choice === "section:finished" ? "finished" : "active";
      const replaced = listDialog(closed, msg.dialog, { kind: "tasks", section });

      return stay(withLocal(closed, { dialogs: [...closed.local.dialogs, replaced] }));
    }

    if (choice === null) return stay(state);

    if (msg.action === "chat.task.stop")
      return reduce(state, { kind: "stop-task", task: choice }, now);

    return openDialog(state, { kind: "inspector", task: choice }, now, reduce);
  },
  provider: (state, purpose, msg, now, reduce) =>
    msg.choice === null
      ? stay(closing(state, msg))
      : openDialog(
          closing(state, msg),
          { kind: "auth", mode: purpose.mode, provider: msg.choice },
          now,
          reduce,
        ),
  accounts: (state, purpose, msg) => {
    const account = purpose.accounts.find(
      (candidate) => JSON.stringify([candidate.provider, candidate.id]) === msg.choice,
    );

    if (account === undefined) return stay(state);
    const closed = closing(state, msg);

    if (account.active) return stay(closed);

    return {
      state: withLocal(closed, {
        pending: [
          ...closed.local.pending,
          { kind: "auth", provider: account.provider, link: null },
        ],
      }),
      effects: [
        {
          kind: "select-account",
          provider: account.provider,
          account: account.id,
          label: account.label,
        },
      ],
    };
  },
};
