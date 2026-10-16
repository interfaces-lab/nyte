import type { MessageId, SessionId, SessionView } from "@nyte-ai/sdk";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import { shortId } from "../../lib/format.ts";
import { CLOSED, explicitMentionQuery, nextCompletion } from "../completion.ts";
import { addPart } from "../draft.ts";
import type { Fact } from "../msg.ts";
import { currentQuestion, sameQuestion } from "../question.ts";
import { followedSession, followedShells } from "../state.ts";
import type { FollowedSession, Handback, ShellJob, State } from "../state.ts";
import { andThen, insertText, setDraft, stay, withFacts, withLocal, withNotice } from "../step.ts";
import type { MsgOf, SomeHandlers, Step } from "../step.ts";
import { deriveTranscript } from "../transcript.ts";
import { anchorAt } from "../window.ts";

/**
 * Wraps a handler for a fact about one session: the fact applies only while that session is
 * the followed one, and is dropped otherwise.
 */
function followedOnly<M extends { readonly session: SessionId }>(
  handle: (state: State, session: FollowedSession, msg: M, now: number) => Step,
): (state: State, msg: M, now: number) => Step {
  return (state, msg, now) => {
    const session = followedSession(state);

    return session !== null && session.id === msg.session
      ? handle(state, session, msg, now)
      : stay(state);
  };
}

export const factHandlers = {
  phase: (state, msg) => stay(withFacts(state, { phase: msg.phase })),
  "session-opened": (state, msg) => ({
    state: opened(state, msg),
    effects: [{ kind: "check-trust", workspace: msg.info.workspace, ask: "if-needed" }],
  }),
  "blank-opened": (state, msg) => ({
    state: withLocal(entered(withFacts(state, { chat: msg.chat, tasks: [] })), {
      pending: state.local.pending.filter((op) => op.kind !== "switch"),
    }),
    effects: [{ kind: "check-trust", workspace: msg.chat.workspace, ask: "if-needed" }],
  }),
  view: followedOnly<MsgOf<"view">>((state, session, msg, now) =>
    viewArrived(state, session, msg.view, now),
  ),
  "watch-ended": followedOnly<MsgOf<"watch-ended">>((state, session, msg) =>
    stay(
      withFacts(state, {
        chat: { ...session, watch: { kind: "failed", failure: msg.failure } },
      }),
    ),
  ),
  "session-info": followedOnly<MsgOf<"session-info">>((state, session, msg) =>
    stay(withFacts(state, { chat: { ...session, info: msg.info } })),
  ),
  selection: (state, msg) => {
    const { chat } = state.facts;

    return chat === null || chat.id !== msg.session
      ? stay(state)
      : stay(withFacts(state, { chat: { ...chat, selection: msg.selection } }));
  },
  tasks: followedOnly<MsgOf<"tasks">>((state, _session, msg) =>
    stay(questionMoved(state, withFacts(state, { tasks: msg.tasks }))),
  ),
  catalog: (state, msg) =>
    msg.generation < state.facts.catalog.generation
      ? stay(state)
      : stay(withFacts(state, { catalog: { generation: msg.generation, catalog: msg.catalog } })),
  settings: (state, msg) => stay(withFacts(state, { settings: msg.settings })),
  workspace: (state, msg) =>
    stay(
      withLocal(withFacts(state, { workspace: msg.workspace }), {
        pasteGeneration:
          msg.workspace.cwd === state.facts.workspace.cwd
            ? state.local.pasteGeneration
            : state.local.pasteGeneration + 1,
      }),
    ),
  "shell-job": (state, msg) => shellReported(state, msg.job),
  terminal: (state, msg) => stay(withFacts(state, { terminal: msg.terminal })),
  remote: (state, msg) => stay(withFacts(state, { remote: msg.remote })),
  "draft-changed": (state, msg, now) => draftChanged(state, msg, now),
  scrolled: (state, msg) => stay(scrolled(state, msg.atBottom)),
  failure: (state, msg) =>
    stay(withLocal(state, { failures: [...state.local.failures, msg.failure] })),
  tick: (state) => stay(state),
} satisfies SomeHandlers;

function opened(state: State, msg: Extract<Fact, { kind: "session-opened" }>): State {
  return entered(
    withFacts(state, {
      chat: {
        kind: "session",
        id: msg.session,
        info: msg.info,
        view: null,
        watch: { kind: "live" },
        selection: msg.selection,
      },
      tasks: [],
    }),
  );
}

/** Resets what belonged to the chat on screen before: its question, scroll and history. */
function entered(next: State): State {
  return withLocal(next, {
    question: { ...next.local.question, dismissed: null, highlighted: 0 },
    transcript: {
      ...next.local.transcript,
      following: true,
      window: { kind: "tail" },
      disclosures: new Set(),
    },
    completion: CLOSED,
    history: null,
    escapeArmedAt: null,
    watchedRun: null,
  });
}

function viewArrived(state: State, session: FollowedSession, view: SessionView, now: number): Step {
  const before = session.view;
  let next = withFacts(state, { chat: { ...session, view } });

  if (view.execution.kind !== "idle") next = withLocal(next, { watchedRun: view.execution.run.id });
  next = questionMoved(state, next);
  let step: Step = stay(next);

  if (before === null) step = andThen(step, (current) => firstView(current, now));
  step = andThen(step, (current) => runEnded(before, view, current, now));
  step = andThen(step, (current) => editLanded(current, now));

  return andThen(step, (current) => landHandback(current, now));
}

function followedHead(
  state: State,
): { readonly id: SessionId; readonly view: SessionView | null } | null {
  const session = followedSession(state);

  return session === null ? null : { id: session.id, view: session.view };
}

function questionMoved(before: State, after: State): State {
  const previous = currentQuestion(followedHead(before), before.facts.tasks, before.local.question);

  const current = currentQuestion(followedHead(after), after.facts.tasks, after.local.question);

  const local = after.local.question;

  let drafts = local.drafts;

  const session = followedSession(after);

  const observed = [
    ...(session?.view === null || session === null
      ? []
      : [{ session: session.id, view: session.view }]),
    ...after.facts.tasks.flatMap((task) =>
      task.kind === "agent" && task.view !== undefined
        ? [{ session: task.id, view: task.view }]
        : [],
    ),
  ];

  for (const owner of observed) {
    const held = drafts.get(owner.session);

    if (held === undefined) continue;

    const open = new Set(openQuestions(owner.view).map((question) => question.part));

    const kept = new Map(
      [...held].filter(([part, draft]) => open.has(part) || draft.phase === "submitting"),
    );

    if (kept.size === held.size) continue;

    const pruned = new Map(drafts);

    if (kept.size === 0) pruned.delete(owner.session);
    else pruned.set(owner.session, kept);
    drafts = pruned;
  }

  const changed = !sameQuestion(previous, current);

  return !changed && drafts === local.drafts
    ? after
    : withLocal(after, {
        question: {
          ...local,
          drafts,
          dismissed: changed ? null : local.dismissed,
          highlighted: changed ? 0 : local.highlighted,
        },
      });
}

function firstView(state: State, now: number): Step {
  const session = followedSession(state);

  if (session === null) return stay(state);
  const switching = state.local.pending.find((op) => op.kind === "switch");

  let next = withLocal(state, {
    pending: state.local.pending.filter((op) => op.kind !== "switch"),
  });

  if (switching?.kind === "switch" && switching.announce)
    next = withNotice(
      next,
      `Resumed ${shortId(session.id)} · ${String(session.view?.turns.length ?? 0)} turns`,
      "info",
      now,
    );
  const saved = next.local.drafts[session.id];

  if (saved === undefined || next.local.draft.text !== "") return deliverShells(next);

  const drafts = Object.fromEntries(
    Object.entries(next.local.drafts).filter(([key]) => key !== session.id),
  );

  const edits = Object.fromEntries(
    Object.entries(next.local.edits).filter(([key]) => key !== session.id),
  );

  const restored = withLocal(next, {
    drafts,
    edits,
    editing: next.local.edits[session.id] ?? null,
  });

  return andThen(setDraft(restored, saved), deliverShells);
}

function unansweredRequest(
  view: SessionView,
): { readonly message: MessageId; readonly commit: string } | null {
  const turn = view.turns.at(-1);

  if (turn === undefined || turn.prompt === null) return null;
  const messages = view.messages.filter((message) => message.turn === turn.id);
  const only = messages[0];

  return messages.length === 1 && only?.kind === "user" && only.status.kind === "landed"
    ? { message: only.id, commit: only.status.commit }
    : null;
}

function runEnded(before: SessionView | null, after: SessionView, next: State, now: number): Step {
  const session = followedSession(next);

  if (
    before === null ||
    before.execution.kind === "idle" ||
    after.execution.kind !== "idle" ||
    session === null
  )
    return stay(next);
  const end = after.execution.lastRun?.end;

  const refresh: Step = {
    state: next,
    effects: [{ kind: "refresh-workspace", cwd: next.facts.workspace.cwd }],
  };

  if (end?.kind === "failed")
    return { ...refresh, state: withNotice(next, `Error: ${end.failure.message}`, "error", now) };

  if (end?.kind !== "stopped" || next.local.draft.text.trim() !== "" || next.local.editing !== null)
    return refresh;
  const request = unansweredRequest(after);
  const commit = after.messages.find((message) => message.id === request?.message);

  if (request === null || commit?.kind !== "user" || commit.status.kind !== "landed")
    return refresh;

  return {
    state: withLocal(next, { move: { purpose: "retract", message: request.message } }),
    effects: [
      ...refresh.effects,
      {
        kind: "move",
        session: session.id,
        position: { kind: "commit", id: commit.status.commit },
        options: {},
        handback: null,
      },
    ],
  };
}

function editLanded(state: State, now: number): Step {
  const { editing } = state.local;
  const view = followedSession(state)?.view;

  if (editing === null || view === null || view === undefined) return stay(state);

  const stillQueued = view.messages.some(
    (message) =>
      message.id === editing.message && message.kind === "user" && message.status.kind !== "landed",
  );

  if (stillQueued) return stay(state);

  return stay(
    withNotice(
      withLocal(state, { editing: null }),
      "That message was sent before the edit was saved; your text stays in the composer.",
      "warning",
      now,
    ),
  );
}

export function stageHandback(
  state: State,
  session: SessionId,
  handback: Handback,
  now: number,
): Step {
  const handbacks = state.local.handbacks[session] ?? [];

  return landHandback(
    withLocal(state, {
      handbacks: { ...state.local.handbacks, [session]: [...handbacks, handback] },
    }),
    now,
  );
}

function landHandback(next: State, now: number): Step {
  const session = next.facts.chat;
  const view = session?.kind === "session" ? session.view : null;

  if (session === null || (session.kind === "session" && view === null)) return stay(next);
  const [head, ...rest] = next.local.handbacks[session.id] ?? [];

  if (head === undefined) return stay(next);

  if (
    next.local.draft.text.trim() !== "" ||
    next.local.dialogs.length > 0 ||
    next.local.editing !== null
  )
    return stay(next);

  if (
    head.unlessLanded !== null &&
    view !== null &&
    view.messages.some(
      (candidate) =>
        candidate.id === head.unlessLanded &&
        candidate.kind === "user" &&
        candidate.status.kind === "landed",
    )
  )
    return stay(next);

  const dropped = withLocal(next, {
    handbacks: { ...next.local.handbacks, [session.id]: rest },
    history: null,
  });

  const landed = setDraft(dropped, head.draft);

  return head.notice === null
    ? landed
    : { ...landed, state: withNotice(landed.state, head.notice, "ok", now) };
}

function shellReported(state: State, job: ShellJob): Step {
  const known = state.facts.shells.find((candidate) => candidate.id === job.id);
  const reported = { ...job, delivered: known?.delivered ?? job.delivered };

  const shells =
    known === undefined
      ? [...state.facts.shells, reported]
      : state.facts.shells.map((candidate) => (candidate.id === job.id ? reported : candidate));

  return deliverShells(withFacts(state, { shells }));
}

function deliverShells(state: State): Step {
  if (state.local.dialogs.length > 0) return stay(state);

  return followedShells(state).reduce<Step>((step, job) => {
    if (!job.include || job.delivered || job.state.kind !== "exited") return step;
    const exit = job.state.code;

    return andThen(step, (current) => {
      const shells = current.facts.shells.map((candidate) =>
        candidate.id === job.id ? { ...candidate, delivered: true } : candidate,
      );

      const added = addPart(current.local.draft.parts, {
        kind: "shell",
        command: job.command,
        output: job.output,
        exit,
      });

      return insertText(
        withLocal(withFacts(current, { shells }), {
          draft: { ...current.local.draft, parts: added.parts },
        }),
        `${added.marker} `,
        "start",
      );
    });
  }, stay(state));
}

function draftChanged(
  state: State,
  msg: Extract<Fact, { kind: "draft-changed" }>,
  now: number,
): Step {
  const { draft } = state.local;
  const changed = msg.text !== draft.text;
  const mirror = { text: msg.text, cursor: msg.cursor, row: msg.row, parts: draft.parts };
  const completion = nextCompletion(state.local.completion, mirror);
  const preview = state.local.preview;

  const next = withLocal(state, {
    draft: mirror,
    completion,
    history: changed ? null : state.local.history,
    preview: preview !== null && !msg.text.includes(preview) ? null : preview,
  });

  const lookup = completionLookup(state.local.completion, next);

  return andThen(lookup, (current) => landHandback(current, now));
}

export function completionLookup(before: State["local"]["completion"], next: State): Step {
  const after = next.local.completion;

  if (after.kind !== "open" || after.directories !== null || after.explicit !== null)
    return stay(next);

  if (
    before.kind === "open" &&
    before.token.trigger === after.token.trigger &&
    before.token.query === after.token.query
  )
    return stay(next);
  const { cwd } = next.facts.workspace;

  if (after.token.trigger === "cd")
    return { state: next, effects: [{ kind: "list-directory", path: after.token.query, cwd }] };

  if (after.token.trigger === "@" && explicitMentionQuery(after.token.query))
    return { state: next, effects: [{ kind: "resolve-mention", query: after.token.query, cwd }] };

  return stay(next);
}

function scrolled(state: State, atBottom: boolean): State {
  const { transcript } = state.local;

  const model = deriveTranscript(
    followedSession(state)?.view ?? null,
    followedShells(state),
    transcript,
    null,
  );

  if (atBottom && model.window.end === model.rows.length)
    return withLocal(state, {
      transcript: { ...transcript, following: true, window: { kind: "tail" } },
    });

  if (transcript.window.kind !== "tail")
    return withLocal(state, { transcript: { ...transcript, following: false } });

  return withLocal(state, {
    transcript: { ...transcript, following: false, window: anchorAt(model.rows, model.window) },
  });
}
