import type { Delivery, SessionId } from "@nyte-ai/sdk";
import { resolveCommand, runnableCommand, slashNamespace } from "../commands.ts";
import {
  completionEdit,
  completionModel,
  dismissCompletion,
  inlineTokenRange,
  moveCompletion,
  nextCompletion,
  splice,
} from "../completion.ts";
import type { CompletionModel } from "../completion.ts";
import { dialogText } from "../dialogs/dialog.ts";
import {
  addPart,
  draftFromContent,
  draftModel,
  liveMarkers,
  markerAt,
  NO_PARTS,
  PASTE_COLLAPSE_CHARS,
  PASTE_COLLAPSE_LINES,
  sameSnapshot,
  snapshot,
} from "../draft.ts";
import type { DraftSnapshot } from "../draft.ts";
import { promptEntries } from "../history.ts";
import type { Intent, Outcome } from "../msg.ts";
import { rowMessage } from "../queue.ts";
import { keyboardDialog } from "../screen.ts";
import { followedSession } from "../state.ts";
import type { State } from "../state.ts";
import {
  andThen,
  clearDraft,
  following,
  insertText,
  mint,
  moveCursor,
  refuse,
  replaceRange,
  setDraft,
  stay,
  withLocal,
  withNotice,
} from "../step.ts";
import type { Reduce, SomeHandlers, Step } from "../step.ts";
import { dialogCommand } from "./dialogs.ts";
import { completionLookup, stageHandback } from "./facts.ts";

export const composerHandlers = {
  send: (state, msg, now, reduce) => send(state, msg.delivery, msg.warning ?? null, now, reduce),
  "save-edit": (state, msg, now) => saveEdit(state, msg.delivery, now),
  "cancel-edit": (state) => {
    const { editing } = state.local;

    return editing === null
      ? stay(state)
      : setDraft(withLocal(state, { editing: null }), editing.saved);
  },
  "clear-draft": (state) => clearDraft(state),
  "recall-first-message": (state, _msg, now) => {
    const { chat } = state.facts;
    const waiting = state.local.submissions.find((sent) => sent.session === chat?.id);

    if (chat?.kind !== "blank" || waiting === undefined) return stay(state);

    return stageHandback(
      withLocal(state, {
        submissions: state.local.submissions.filter((sent) => sent !== waiting),
      }),
      chat.id,
      { draft: waiting.snapshot, notice: null, unlessLanded: null },
      now,
    );
  },
  "run-shell": (state, msg, now) => {
    if (state.facts.shells.some((job) => job.state.kind === "running"))
      return refuse(state, "A command is already running", now);
    const minted = mint(state, "shell");

    return andThen(clearDraft(minted.state), (current) => ({
      state: following(current),
      effects: [
        {
          kind: "shell-start",
          id: minted.id,
          session: current.facts.chat?.id ?? null,
          command: msg.command,
          include: msg.include,
          cwd: current.facts.workspace.cwd,
        },
        { kind: "scroll", op: { kind: "latest" } },
      ],
    }));
  },
  "stop-shell": (state) => {
    const running = state.facts.shells.find((job) => job.state.kind === "running");

    return running === undefined
      ? stay(state)
      : { state, effects: [{ kind: "shell-stop", id: running.id }] };
  },
  history: (state, msg) => history(state, msg.direction),
  paste: (state, msg, now, reduce) => {
    const dialog = keyboardDialog(state);

    if (dialog !== null) {
      if (dialogText(dialog) === null) return stay(state);

      return msg.source.kind === "clipboard"
        ? {
            state,
            effects: [
              {
                kind: "read-dialog-clipboard",
                dialog: dialog.id,
                promptVersion: dialog.kind === "auth" ? (dialog.promptVersion ?? 0) : null,
              },
            ],
          }
        : dialogCommand(state, { kind: "paste", text: msg.source.text }, now, reduce);
    }

    const generation = state.local.pasteGeneration;

    const next = withLocal(state, {
      history: null,
      notice: null,
      pasting: state.local.pasting + 1,
    });

    if (msg.source.kind === "clipboard")
      return { state: next, effects: [{ kind: "read-clipboard", generation }] };

    return {
      state: next,
      effects: [
        {
          kind: "resolve-paste",
          generation,
          text: msg.source.text,
          bytes: msg.source.bytes,
          cwd: state.facts.workspace.cwd,
        },
      ],
    };
  },
  "open-editor": (state) => {
    if (state.local.pending.some((op) => op.kind === "editor")) return stay(state);

    return {
      state: withLocal(state, { pending: [...state.local.pending, { kind: "editor" }] }),
      effects: [
        {
          kind: "open-editor",
          text: state.local.draft.text,
          command: state.facts.settings.externalEditor ?? null,
        },
      ],
    };
  },
  "open-attachment": (state) => {
    const span = markerAt(state.local.draft);
    const part = span === null ? undefined : state.local.draft.parts.get(span.marker);

    if (span === null || part === undefined) return stay(state);

    if (part.kind === "paste") return replaceRange(state, span.from, span.to, part.text);

    if (state.local.preview === span.marker) return stay(withLocal(state, { preview: null }));
    const next = withLocal(state, { preview: span.marker });

    return part.kind === "file" && !part.directory && part.body === undefined
      ? { state: next, effects: [{ kind: "read-preview", marker: span.marker, path: part.path }] }
      : stay(next);
  },
  "close-preview": (state) => stay(withLocal(state, { preview: null })),
  "focus-composer": (state) => ({ state, effects: [{ kind: "composer", op: { kind: "focus" } }] }),
  completion: (state, msg, now, reduce) => completion(state, msg.action, now, reduce),
  prefill: (state, msg) => insertText(state, msg.text, "start"),
  sent: (state, msg, now) => {
    const submission = state.local.submissions.find((candidate) => candidate.id === msg.submission);

    const next = withLocal(state, {
      submissions: state.local.submissions.filter((candidate) => candidate.id !== msg.submission),
    });

    return submission?.replace === null || submission === undefined
      ? stay(next)
      : stay(withNotice(next, "Queued message saved.", "info", now));
  },
  "send-refused": (state, msg, now) => {
    const submission = state.local.submissions.find((candidate) => candidate.id === msg.submission);

    const next = withNotice(
      withLocal(state, {
        submissions: state.local.submissions.filter((candidate) => candidate.id !== msg.submission),
      }),
      msg.reason,
      "warning",
      now,
    );

    const target = submission?.session ?? state.facts.chat?.id;

    if (target === undefined) return stay(next);

    return stageHandback(
      next,
      target,
      { draft: msg.snapshot, notice: null, unlessLanded: null },
      now,
    );
  },
  "paste-resolved": (state, msg, now, reduce) => pasted(state, msg, now, reduce),
  "editor-closed": (state, msg) => {
    const next = withLocal(state, {
      pending: state.local.pending.filter((op) => op.kind !== "editor"),
    });

    return msg.text === null
      ? stay(next)
      : setDraft(next, { text: msg.text, parts: next.local.draft.parts });
  },
  "preview-loaded": (state, msg) => {
    const { draft } = state.local;
    const part = draft.parts.get(msg.marker);

    if (msg.body === null || part?.kind !== "file" || part.path !== msg.path) return stay(state);
    const parts = new Map(draft.parts).set(msg.marker, { ...part, body: msg.body });

    return stay(withLocal(state, { draft: { ...draft, parts } }));
  },
  "directory-listed": (state, msg) => {
    const current = state.local.completion;

    if (
      current.kind !== "open" ||
      current.token.trigger !== "cd" ||
      current.token.query !== msg.path
    )
      return stay(state);

    return stay(
      withLocal(state, {
        completion: { ...current, directories: { path: msg.path, entries: msg.entries } },
      }),
    );
  },
  "mention-resolved": (state, msg) => {
    const current = state.local.completion;

    if (
      current.kind !== "open" ||
      current.token.trigger !== "@" ||
      current.token.query !== msg.query ||
      state.facts.workspace.cwd !== msg.cwd
    )
      return stay(state);

    return stay(withLocal(state, { completion: { ...current, explicit: msg.file } }));
  },
  "command-unknown": (state, msg) =>
    submitSnapshot(
      state,
      msg.session,
      { text: `/${msg.name}${msg.argument === null ? "" : ` ${msg.argument}`}`, parts: NO_PARTS },
      msg.delivery,
    ),
} satisfies SomeHandlers;

function send(
  state: State,
  delivery: Delivery,
  warning: string | null,
  now: number,
  reduce: Reduce,
): Step {
  const followed = state.facts.chat;

  if (followed === null) return refuse(state, "Wait for the chat to open", now);

  if (state.local.pasting > 0)
    return stay(withLocal(state, { sendAfterPaste: { delivery, warning } }));
  const draft = draftModel(state.local.draft);

  if (draft.kind !== "message") return stay(state);
  const command = draft.command === null ? null : runnableCommand(state, draft.text);

  if (command?.entry.name === "cd" && command.argument === "")
    return refuse(state, "error: Directory is required. Use /cd <path>.", now, "error");

  if (command !== null) {
    const intent = command.entry.run(command.argument) ?? {
      kind: "prefill",
      text: `/${command.entry.name} `,
    };

    return andThen(clearDraft(state), (current) =>
      reduce(current, intent.kind === "plugin-command" ? { ...intent, delivery } : intent, now),
    );
  }

  const noticed = warning === null ? state : withNotice(state, warning, "warning", now);

  return andThen(clearDraft(noticed), (current) =>
    submitSnapshot(current, followed.id, snapshot(state.local.draft), delivery),
  );
}

function submitSnapshot(
  state: State,
  to: SessionId,
  draft: DraftSnapshot,
  delivery: Delivery,
): Step {
  const minted = mint(state, "submission");
  const submission = { id: minted.id, session: to, snapshot: draft, replace: null };

  return {
    state: following(
      withLocal(minted.state, { submissions: [...minted.state.local.submissions, submission] }),
    ),
    effects: [
      { kind: "send", submission, delivery },
      { kind: "scroll", op: { kind: "latest" } },
    ],
  };
}

function saveEdit(state: State, delivery: Delivery, now: number): Step {
  const { editing } = state.local;
  const followed = followedSession(state);

  if (editing === null || followed === null) return stay(state);
  const message = rowMessage(followed, editing.message);

  if (message === null || message.status.kind === "landed")
    return refuse(withLocal(state, { editing: null }), "Already sent", now);
  const edited = snapshot(state.local.draft);
  const restore = setDraft(withLocal(state, { editing: null }), editing.saved);

  if (delivery === editing.delivery && sameSnapshot(edited, draftFromContent(message.content)))
    return restore;
  const minted = mint(restore.state, "submission");

  const submission = {
    id: minted.id,
    session: followed.id,
    snapshot: edited,
    replace: editing.message,
  };

  return {
    state: withLocal(minted.state, {
      submissions: [...minted.state.local.submissions, submission],
    }),
    effects: [...restore.effects, { kind: "send", submission, delivery }],
  };
}

function history(state: State, direction: "previous" | "next"): Step {
  const { draft } = state.local;
  const entries = promptEntries(followedSession(state)?.view ?? null);
  const cursor = state.local.history;

  if (direction === "previous") {
    if (draft.cursor !== 0) return moveCursor(state, "start");

    if (entries.length === 0) return stay(state);
    const index = cursor === null ? entries.length - 1 : cursor.index - 1;
    const entry = entries[index];

    if (entry === undefined) return stay(state);

    const browsing = withLocal(state, {
      history: { index, saved: cursor?.saved ?? snapshot(draft) },
    });

    return andThen(setDraft(browsing, entry), (current) => moveCursor(current, "start"));
  }

  if (draft.cursor < draft.text.length) return moveCursor(state, "end");

  if (cursor === null) return stay(state);
  const entry = entries[cursor.index + 1];

  if (entry === undefined) return setDraft(withLocal(state, { history: null }), cursor.saved);

  return setDraft(withLocal(state, { history: { ...cursor, index: cursor.index + 1 } }), entry);
}

function completion(
  state: State,
  action: Extract<Intent, { kind: "completion" }>["action"],
  now: number,
  reduce: Reduce,
): Step {
  const model = completionModel(state.local.completion, state.local.draft, {
    commands: slashNamespace(state),
    files: state.facts.workspace.mentions,
  });

  if (model === null) return stay(state);

  switch (action.kind) {
    case "close":
      return stay(withLocal(state, { completion: dismissCompletion(state.local.completion) }));
    case "move":
      return stay(
        withLocal(state, { completion: moveCompletion(state.local.completion, model, action.by) }),
      );
    case "pick":
      return acceptCompletion(state, model, action.index, "return", null, now, reduce);
    case "fill":
      return acceptCompletion(state, model, model.highlighted, "tab", null, now, reduce);
    case "accept":
      return acceptCompletion(
        state,
        model,
        model.highlighted,
        "return",
        action.alternate,
        now,
        reduce,
      );
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

function recomplete(current: State): Step {
  return completionLookup(
    current.local.completion,
    withLocal(current, {
      completion: nextCompletion(current.local.completion, current.local.draft),
    }),
  );
}

function acceptCompletion(
  state: State,
  model: CompletionModel,
  index: number,
  via: "return" | "tab",
  alternate: Delivery | null,
  now: number,
  reduce: Reduce,
): Step {
  const item = model.items[index];

  if (item === undefined) return stay(state);

  const edit = completionEdit(model, item, state.local.draft, alternate === null ? via : "tab", {
    commands: slashNamespace(state),
    files: state.facts.workspace.mentions,
  });

  if (edit === null) return stay(state);

  switch (edit.kind) {
    case "replace": {
      const spliced = splice(state.local.draft.text, edit.from, edit.to, edit.text);

      const replaced = andThen(
        replaceRange(state, edit.from, edit.to, spliced.inserted),
        recomplete,
      );

      return alternate === null
        ? replaced
        : andThen(replaced, (current) => send(current, alternate, null, now, reduce));
    }

    case "file": {
      const added = addPart(state.local.draft.parts, {
        kind: "file",
        path: edit.path,
        directory: edit.directory,
      });

      const spliced = splice(state.local.draft.text, edit.from, edit.to, `${added.marker} `);
      const withPart = withLocal(state, { draft: { ...state.local.draft, parts: added.parts } });

      return andThen(replaceRange(withPart, edit.from, edit.to, spliced.inserted), recomplete);
    }

    case "execute": {
      const entry = resolveCommand(state, edit.name);
      const intent: Intent = entry?.run("") ?? { kind: "prefill", text: `/${edit.name} ` };
      const range = inlineTokenRange(state.local.draft.text, edit.from, edit.to);

      const cleared = edit.leading
        ? clearDraft(state)
        : andThen(replaceRange(state, range.from, range.to, ""), recomplete);

      return andThen(cleared, (current) => reduce(current, intent, now));
    }

    default: {
      const _exhaustive: never = edit;

      return _exhaustive;
    }
  }
}

function pasted(
  state: State,
  msg: Extract<Outcome, { kind: "paste-resolved" }>,
  now: number,
  reduce: Reduce,
): Step {
  const pasting = Math.max(0, state.local.pasting - 1);
  const held = state.local.sendAfterPaste;
  const refused = msg.insert.kind === "refused";

  const landed = withLocal(state, {
    pasting,
    sendAfterPaste: pasting > 0 && !refused ? held : null,
  });

  const step =
    msg.generation === state.local.pasteGeneration ? insertPaste(landed, msg, now) : stay(landed);

  return held === null || pasting > 0 || refused
    ? step
    : andThen(step, (current) => send(current, held.delivery, held.warning, now, reduce));
}

function insertPaste(
  state: State,
  msg: Extract<Outcome, { kind: "paste-resolved" }>,
  now: number,
): Step {
  const { insert } = msg;
  const { draft } = state.local;

  if (insert.kind === "refused") return refuse(state, insert.reason, now);

  if (insert.kind === "text") {
    const before = liveMarkers(draft).find(
      (span) => span.to === draft.cursor || span.to + 1 === draft.cursor,
    );

    const part = before === undefined ? undefined : draft.parts.get(before.marker);

    if (before !== undefined && part?.kind === "paste" && part.text === insert.text)
      return replaceRange(state, before.from, before.to, insert.text);

    if (
      insert.text.length <= PASTE_COLLAPSE_CHARS &&
      insert.text.split("\n").length <= PASTE_COLLAPSE_LINES
    )
      return insertText(state, insert.text, "cursor");
    const added = addPart(draft.parts, { kind: "paste", text: insert.text });

    return insertText(
      withLocal(state, { draft: { ...draft, parts: added.parts } }),
      `${added.marker} `,
      "cursor",
    );
  }

  const added = addPart(draft.parts, insert.part);

  if (insert.part.kind === "image" && draft.text.includes(added.marker)) return stay(state);

  return insertText(
    withLocal(state, { draft: { ...draft, parts: added.parts } }),
    `${added.marker} `,
    "cursor",
  );
}
