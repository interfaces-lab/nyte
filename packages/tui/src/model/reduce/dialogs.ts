import { GLYPHS } from "../../lib/constants.ts";
import {
  initialHighlight,
  listTitle,
  liveChoices,
  resumeChoices,
  shortcutLines,
} from "../choices.ts";
import { resolveCommand } from "../commands.ts";
import { withPrompt } from "../dialogs/auth.ts";
import { dialogText, reduceDialog } from "../dialogs/dialog.ts";
import type { Dialog, DialogInput, DialogRequest, LoadRequest } from "../dialogs/dialog.ts";
import { typedLabel } from "../dialogs/list.ts";
import type { ListDialog, ListPurpose } from "../dialogs/list.ts";
import { modelList, withModels } from "../dialogs/model-picker.ts";
import type { ModelDialog } from "../dialogs/model-picker.ts";
import { withTree } from "../dialogs/tree.ts";
import type { Effect } from "../effect.ts";
import type { Intent, Outcome } from "../msg.ts";
import { readQuestionDraft } from "../question.ts";
import { keyboardDialog } from "../screen.ts";
import { chatFolder, followedSession } from "../state.ts";
import type { PendingOp, State } from "../state.ts";
import {
  andThen,
  busy,
  insertText,
  mint,
  refuse,
  refuseUnstarted,
  stay,
  withLocal,
  withNotice,
} from "../step.ts";
import type { Reduce, SomeHandlers, Step } from "../step.ts";

export const dialogHandlers = {
  open: (state, msg, now, reduce) => openDialog(state, msg.dialog, now, reduce),
  dialog: (state, msg, now, reduce) => dialogCommand(state, msg.command, now, reduce),
  "run-command": (state, msg, now, reduce) => {
    const entry = resolveCommand(state, msg.name);

    if (entry === null) return refuse(state, `Unknown command /${msg.name}`, now);

    return reduce(
      state,
      entry.run(msg.argument) ?? { kind: "prefill", text: `/${entry.name} ` },
      now,
    );
  },
  refuse: (state, msg, now) => refuse(state, msg.reason, now, msg.tone ?? "warning"),
  "dismiss-notice": (state) =>
    stay(
      withLocal(state, {
        notice: null,
        watchedRun: busy(state) ? state.local.watchedRun : null,
      }),
    ),
  noop: (state) => stay(state),
  loaded: (state, msg, now) => loaded(state, msg, now),
  "load-failed": (state, msg) =>
    stay(
      withLocal(state, {
        dialogs: state.local.dialogs.map((dialog): Dialog => {
          if (dialog.id !== msg.dialog) return dialog;
          const failed = { kind: "failed", message: msg.message } as const;

          switch (dialog.kind) {
            case "list":
              return { ...dialog, choices: failed };
            case "model":
              return { ...dialog, models: failed };
            case "tree":
              return { ...dialog, tree: failed };
            case "text":
              return { ...dialog, body: failed };
            default:
              return dialog;
          }
        }),
      }),
    ),
  "dialog-pasted": (state, msg, now, reduce) => {
    const dialog = keyboardDialog(state);

    if (
      dialog?.id !== msg.dialog ||
      dialogText(dialog) === null ||
      (dialog.kind === "auth" ? (dialog.promptVersion ?? 0) : null) !== msg.promptVersion
    )
      return stay(state);

    return msg.text === null
      ? stay(state)
      : dialogCommand(state, { kind: "paste", text: msg.text }, now, reduce);
  },
} satisfies SomeHandlers;

export function push(state: State, dialog: Dialog, effects: readonly Effect[] = []): Step {
  return { state: withLocal(state, { dialogs: [...state.local.dialogs, dialog] }), effects };
}

export function listDialog(state: State, id: string, purpose: ListPurpose): ListDialog {
  const items = liveChoices(state, purpose);

  return {
    kind: "list",
    id,
    purpose,
    title: listTitle(state, purpose),
    choices: items === null ? { kind: "loading" } : { kind: "ready", items },
    query: "",
    highlighted: items === null ? 0 : initialHighlight(state, purpose, items),
    answering: typedLabel(purpose) === null ? null : "",
    busy: false,
  };
}

function listRequest(purpose: ListPurpose): LoadRequest | null {
  switch (purpose.kind) {
    case "resume":
      return { kind: "sessions" };
    case "mcp":
      return { kind: "mcp-servers", workspace: purpose.workspace };
    case "mcp-server":
      return { kind: "mcp-server", workspace: purpose.workspace, server: purpose.server };
    case "accounts":
      return { kind: "accounts", provider: purpose.provider };
    default:
      return null;
  }
}

export function openDialog(
  state: State,
  request: DialogRequest,
  now: number,
  reduce: Reduce,
): Step {
  const followed = state.facts.chat;
  const minted = mint(state, "dialog");
  const { id } = minted;

  switch (request.kind) {
    case "list": {
      const { purpose } = request;

      if (purpose.kind === "question") return reduce(state, { kind: "open-question" }, now);

      if (purpose.kind === "skills" && liveChoices(state, purpose)?.length === 0)
        return refuse(state, "No skills found. Add SKILL.md to .nyte/skills.", now, "info");

      if (purpose.kind === "queue" && liveChoices(state, purpose)?.length === 0)
        return refuse(state, "Nothing is queued", now, "info");

      const load = listRequest(purpose);

      return push(
        minted.state,
        listDialog(minted.state, id, purpose),
        load === null ? [] : [{ kind: "load", dialog: id, request: load }],
      );
    }

    case "model": {
      if (followed === null) return refuse(state, "Wait for the chat to open", now);
      const catalog = state.facts.catalog.catalog;

      const dialog: ModelDialog = {
        kind: "model",
        id,
        models: { kind: "loading" },
        query: "",
        highlighted: 0,
        field: "effort",
        drafts: new Map(),
        current: followed.selection.model,
        effort: followed.selection.effort,
      };

      return push(
        minted.state,
        catalog === null ? dialog : withModels(dialog, modelList(catalog)),
        [{ kind: "load", dialog: id, request: { kind: "models" } }],
      );
    }

    case "tree": {
      const session = followedSession(state);

      if (session === null) return refuseUnstarted(state, now, "Wait for the chat to open");

      if (busy(state))
        return refuse(state, "Wait for the current run before changing the chat branch", now);

      return push(
        minted.state,
        {
          kind: "tree",
          id,
          tree: { kind: "loading" },
          filter: request.filter,
          query: "",
          folded: new Set(),
          selected: null,
          composerEmpty: state.local.draft.text.trim() === "",
        },
        [{ kind: "load", dialog: id, request: { kind: "tree", session: session.id } }],
      );
    }

    case "inspector":
      return push(minted.state, {
        kind: "inspector",
        id,
        task: request.task,
        following: true,
        scroll: null,
      });
    case "text": {
      const title = { usage: "Usage", shortcuts: "Keyboard shortcuts", plugins: "Plugins" }[
        request.content
      ];

      if (request.content === "shortcuts")
        return push(minted.state, {
          kind: "text",
          id,
          title,
          body: { kind: "ready", lines: shortcutLines(state) },
          scroll: 0,
        });

      if (request.content === "usage" && followed === null)
        return refuse(state, "Wait for the chat to open", now);

      return push(minted.state, { kind: "text", id, title, body: { kind: "loading" }, scroll: 0 }, [
        {
          kind: "load",
          dialog: id,
          request:
            request.content === "usage" && followed !== null
              ? { kind: "usage", session: followed.id }
              : { kind: "plugins" },
        },
      ]);
    }

    case "mcp": {
      const folder = followed === null ? null : chatFolder(followed);

      if (folder?.kind !== "folder") return refuse(state, "Wait for the chat to open", now);

      return openDialog(
        state,
        { kind: "list", purpose: { kind: "mcp", workspace: folder.id } },
        now,
        reduce,
      );
    }

    case "mcp-details":
      return push(
        minted.state,
        { kind: "text", id, title: request.server, body: { kind: "loading" }, scroll: 0 },
        [
          {
            kind: "load",
            dialog: id,
            request: { kind: "mcp-details", workspace: request.workspace, server: request.server },
          },
        ],
      );

    case "auth": {
      if (state.local.pending.some((op) => op.kind === "auth"))
        return refuse(state, "An authentication command is already running.", now);

      if (request.provider === null)
        return openDialog(
          state,
          { kind: "list", purpose: { kind: "provider", mode: request.mode } },
          now,
          reduce,
        );
      const pending: PendingOp = { kind: "auth", provider: request.provider, link: null };

      const authenticating = withLocal(minted.state, {
        pending: [...minted.state.local.pending, pending],
      });

      if (request.mode === "logout")
        return { state: authenticating, effects: [{ kind: "logout", provider: request.provider }] };

      return push(
        authenticating,
        {
          kind: "auth",
          id,
          mode: request.mode,
          provider: request.provider,
          name:
            state.facts.catalog.catalog?.providers.find(
              (provider) => provider.id === request.provider,
            )?.name ?? request.provider,
          link: null,
          step: { kind: "starting" },
        },
        [{ kind: "login", provider: request.provider, dialog: id }],
      );
    }

    default: {
      const _exhaustive: never = request;

      return _exhaustive;
    }
  }
}

export function dialogCommand(state: State, input: DialogInput, now: number, reduce: Reduce): Step {
  const dialog = keyboardDialog(state);

  if (dialog === null) return stay(state);

  if (dialog.kind === "list" && dialog.purpose.kind === "question") {
    const text =
      input.kind === "query" || input.kind === "paste"
        ? input.text
        : input.kind === "edit" && input.edit.kind === "insert"
          ? input.edit.text
          : "";

    if (text !== "" && !dialog.busy) {
      const next = withLocal(state, {
        question: {
          ...state.local.question,
          dismissed: { session: dialog.purpose.session, part: dialog.purpose.part },
        },
      });

      return andThen(insertText(next, text, "cursor"), (current) => ({
        state: current,
        effects: [{ kind: "composer", op: { kind: "focus" } }],
      }));
    }
  }

  if (dialog.kind === "list" && dialog.purpose.kind === "approval")
    return approvalCommand(state, dialog, dialog.purpose, input, now, reduce);

  const result = reduceDialog(dialog, input);

  const onStack = state.local.dialogs.at(-1)?.id === dialog.id;

  let next: State;

  if (onStack) {
    const below = state.local.dialogs.slice(0, -1);

    const kept = result.dialog === null ? below : [...below, result.dialog];

    next = withLocal(state, { dialogs: result.push === null ? kept : [...kept, result.push] });
  } else if (dialog.kind === "list" && dialog.purpose.kind === "question") {
    const { purpose } = dialog;

    const after = result.dialog;

    next = withLocal(state, {
      question:
        after === null || after.kind !== "list"
          ? {
              ...state.local.question,
              dismissed: { session: purpose.session, part: purpose.part },
              highlighted: 0,
            }
          : {
              ...state.local.question,
              highlighted: after.highlighted,
              detailScroll:
                after.detailScroll === undefined
                  ? undefined
                  : {
                      part: purpose.part,
                      index: readQuestionDraft(state.local.question, purpose)?.active ?? 0,
                      request: after.detailScroll,
                    },
            },
    });
  } else next = state;

  return all(next, result.intents, now, reduce);
}

/** Keys on the approval panel: typing does nothing, the highlight is kept per part, and closing it denies. */
function approvalCommand(
  state: State,
  dialog: ListDialog,
  purpose: Extract<ListPurpose, { readonly kind: "approval" }>,
  input: DialogInput,
  now: number,
  reduce: Reduce,
): Step {
  if (input.kind === "query" || input.kind === "paste" || input.kind === "edit") return stay(state);
  const result = reduceDialog(dialog, input);
  const after = result.dialog;

  if (after === null)
    return reduce(
      state,
      { kind: "choose", dialog: dialog.id, choice: "deny", typed: null, action: null },
      now,
    );

  const next = withLocal(state, {
    approval: {
      ...state.local.approval,
      part: purpose.part,
      highlighted: after.kind === "list" ? after.highlighted : 0,
    },
  });

  return all(next, result.intents, now, reduce);
}

function all(state: State, intents: readonly Intent[], now: number, reduce: Reduce): Step {
  return intents.reduce<Step>(
    (step, intent) => andThen(step, (current) => reduce(current, intent, now)),
    stay(state),
  );
}

export function findDialog(state: State, id: string): Dialog | null {
  const stacked = state.local.dialogs.find((dialog) => dialog.id === id);

  if (stacked !== undefined) return stacked;
  const panel = keyboardDialog(state);

  return panel?.id === id ? panel : null;
}

export function withoutDialog(state: State, id: string): State {
  return withLocal(state, { dialogs: state.local.dialogs.filter((dialog) => dialog.id !== id) });
}

function loaded(state: State, msg: Extract<Outcome, { kind: "loaded" }>, now: number): Step {
  const target = state.local.dialogs.find((dialog) => dialog.id === msg.dialog);

  if (target === undefined) return stay(state);
  const { data } = msg;
  let effects: readonly Effect[] = [];
  let pending = state.local.pending;

  const update = (dialog: Dialog): Dialog => {
    if (dialog.kind === "list" && data.kind === "list") return { ...dialog, choices: data.choices };

    if (dialog.kind === "list" && dialog.purpose.kind === "accounts" && data.kind === "accounts") {
      const items = data.accounts.map((account) => ({
        id: JSON.stringify([account.provider, account.id]),
        label: account.label,
        description: `${account.provider} · ${account.method.kind === "oauth" ? "OAuth" : "API key"}`,
        timing: null,
        status: account.active ? { text: "active", tone: "ok" as const } : null,
        mark: account.active ? { glyph: GLYPHS.check, tone: "ok" as const } : null,
      }));

      return {
        ...dialog,
        purpose: { ...dialog.purpose, accounts: data.accounts },
        choices: { kind: "ready", items },
        highlighted: Math.max(
          0,
          data.accounts.findIndex((account) => account.active),
        ),
      };
    }

    if (dialog.kind === "list" && data.kind === "sessions") {
      const items = resumeChoices(state, data.sessions);

      return {
        ...dialog,
        purpose:
          dialog.purpose.kind === "resume"
            ? { kind: "resume", sessions: data.sessions.map((info) => info.id) }
            : dialog.purpose,
        choices: { kind: "ready", items },
        highlighted: initialHighlight(state, dialog.purpose, items),
      };
    }

    if (dialog.kind === "model" && data.kind === "models") return withModels(dialog, data.models);

    if (dialog.kind === "tree" && data.kind === "tree") return withTree(dialog, data.tree);

    if (dialog.kind === "text" && data.kind === "text")
      return { ...dialog, body: { kind: "ready", lines: data.lines } };

    if (dialog.kind === "auth" && data.kind === "auth") {
      if (data.step.kind === "link") {
        const { url } = data.step;
        effects = [{ kind: "open-external", target: url }];
        pending = pending.map((op) => (op.kind === "auth" ? { ...op, link: url } : op));
      }

      return withPrompt(dialog, data.step);
    }

    return dialog;
  };

  const next = withLocal(state, {
    dialogs: state.local.dialogs.map((dialog) =>
      dialog.id === msg.dialog ? update(dialog) : dialog,
    ),
    pending,
  });

  if (data.kind !== "auth" || data.step.kind !== "link") return { state: next, effects };
  const { url, code } = data.step;

  return {
    state: withNotice(
      next,
      code === null
        ? `Open this URL to continue: ${url}`
        : `Visit ${url} and enter the code ${code}`,
      "info",
      now,
    ),
    effects,
  };
}
