import { availableModels, clampThinking, findModel, modelId } from "../../lib/catalog.ts";
import { shortId } from "../../lib/format.ts";
import { landingMessages } from "../../lib/view-helpers.ts";
import type { AuthDialog } from "../dialogs/auth.ts";
import { snapshot } from "../draft.ts";
import { queueRows } from "../queue.ts";
import type { PendingOp, Selection, State } from "../state.ts";
import {
  andThen,
  busy,
  clearDraft,
  mint,
  refuse,
  stay,
  withFacts,
  withLocal,
  withNotice,
} from "../step.ts";
import type { SomeHandlers, Step } from "../step.ts";
import { openDialog, push } from "./dialogs.ts";

const HELD_BY_EFFECT: ReadonlyMap<string, PendingOp["kind"]> = new Map([
  ["follow", "switch"],
  ["change-directory", "cd"],
  ["login", "auth"],
  ["logout", "auth"],
  ["reload", "reload"],
  ["open-editor", "editor"],
]);

export const sessionHandlers = {
  "switch-session": (state, msg, now) => {
    const followed = state.facts.session;
    const { pending } = state.local;

    if (pending.some((op) => op.kind === "switch" || op.kind === "cd"))
      return refuse(state, "A chat switch is already in progress", now);

    if (followed !== null && msg.session === followed.id)
      return refuse(state, `Already in ${shortId(followed.id)}`, now, "info");
    const draft = snapshot(state.local.draft);

    const drafts =
      followed === null
        ? state.local.drafts
        : draft.text === ""
          ? Object.fromEntries(
              Object.entries(state.local.drafts).filter(([key]) => key !== followed.id),
            )
          : { ...state.local.drafts, [followed.id]: draft };

    const { editing } = state.local;

    const edits =
      followed === null || editing === null || draft.text === ""
        ? state.local.edits
        : { ...state.local.edits, [followed.id]: editing };

    const switching = withLocal(state, {
      drafts,
      edits,
      pending: [...pending, { kind: "switch", session: msg.session, announce: msg.announce }],
      pasteGeneration: state.local.pasteGeneration + 1,
      sendAfterPaste: null,
      editing: null,
      dialogs: [],
    });

    return andThen(clearDraft(switching), (current) => ({
      state: current,
      effects: [{ kind: "follow", target: msg.session, announce: msg.announce }],
    }));
  },
  "retry-watch": (state) => {
    const followed = state.facts.session;

    if (followed === null || followed.watch.kind === "live") return stay(state);

    return {
      state: withFacts(state, { session: { ...followed, watch: { kind: "live" } } }),
      effects: [{ kind: "follow", target: followed.id, announce: false }],
    };
  },
  "change-directory": (state, msg, now) => {
    const followed = state.facts.session;
    const { pending } = state.local;

    if (followed === null) return stay(state);

    if (busy(state))
      return refuse(state, "Wait for the current run before changing directories", now);

    if (
      queueRows(followed, null).length > 0 ||
      (followed.view !== null && landingMessages(followed.view).length > 0)
    )
      return refuse(
        state,
        "error: Wait for queued messages before changing directories.",
        now,
        "error",
      );

    if (pending.some((op) => op.kind === "switch" || op.kind === "cd"))
      return refuse(state, "Wait for the workspace switch to finish.", now);

    return {
      state: withLocal(state, { pending: [...pending, { kind: "cd", path: msg.path }] }),
      effects: [{ kind: "change-directory", session: followed.id, path: msg.path }],
    };
  },
  reload: (state, _msg, now) => {
    const { pending } = state.local;

    if (pending.some((op) => op.kind === "reload")) return stay(state);

    return {
      state: withNotice(
        withLocal(state, { pending: [...pending, { kind: "reload" }] }),
        "Reloading…",
        "info",
        now,
      ),
      effects: [{ kind: "reload" }],
    };
  },
  compact: (state, msg, now) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    if (busy(state)) return refuse(state, "Wait for the current run before compacting", now);

    return {
      state,
      effects: [{ kind: "compact", session: followed.id, instructions: msg.instructions }],
    };
  },
  update: (state, msg) => ({ state, effects: [{ kind: "self-update", version: msg.version }] }),
  configure: (state, msg, now) => {
    const followed = state.facts.session;
    const step = configure(state, msg.selection, now);
    const level = msg.selection.effort;

    if (followed === null || level === undefined || msg.selection.model !== undefined) return step;
    const already = followed.selection.effort === level;

    return {
      ...step,
      state: withNotice(
        step.state,
        already ? `Already using ${level}` : `Thinking level: ${level}`,
        already ? "info" : "ok",
        now,
      ),
    };
  },
  "write-settings": (state, msg, now) => {
    const settings = withFacts(state, { settings: { ...state.facts.settings, ...msg.patch } });

    return {
      state:
        msg.patch.theme === undefined
          ? settings
          : withNotice(settings, `Theme: ${msg.patch.theme}`, "ok", now),
      effects: [{ kind: "write-settings", patch: msg.patch }],
    };
  },
  "review-trust": (state, _msg, now) => {
    const followed = state.facts.session;

    if (followed === null) return refuse(state, "Wait for the chat to open", now);

    return {
      state,
      effects: [{ kind: "check-trust", workspace: followed.info.workspace, ask: "always" }],
    };
  },
  "mcp-action": (state, msg) => ({
    state,
    effects: [
      { kind: "mcp-action", workspace: msg.workspace, server: msg.server, action: msg.action },
    ],
  }),
  "mcp-login": (state, msg, now) => {
    if (state.local.pending.some((op) => op.kind === "auth"))
      return refuse(state, "An authentication command is already running.", now);
    const minted = mint(state, "dialog");
    const { id } = minted;
    const provider = `mcp:${msg.server}`;

    return push(
      withLocal(minted.state, {
        pending: [...minted.state.local.pending, { kind: "auth", provider, link: null }],
      }),
      {
        kind: "auth",
        id,
        mode: "login",
        provider,
        name: msg.server,
        link: null,
        step: { kind: "starting" },
      },
      [{ kind: "mcp-login", dialog: id, workspace: msg.workspace, server: msg.server }],
    );
  },
  "set-trust": (state, msg) => ({
    state,
    effects: [{ kind: "set-trust", workspace: msg.workspace, value: msg.value }],
  }),
  "apply-setting": (state, msg) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    return {
      state,
      effects: [
        {
          kind: "apply-setting",
          session: followed.id,
          id: msg.id,
          label: msg.label,
          scope: msg.scope,
          value: msg.value,
        },
      ],
    };
  },
  "cycle-thinking": (state, _msg, now) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    const models =
      state.facts.catalog.catalog === null ? [] : availableModels(state.facts.catalog.catalog);

    const supported = findModel(models, followed.selection.model)?.thinking ?? [];

    if (supported.length < 2) return stay(state);

    const current = supported.findIndex((level) => level === followed.selection.effort);
    const next = supported[(current + 1) % supported.length];

    return next === undefined ? stay(state) : configure(state, { effort: next }, now);
  },
  "cycle-model": (state, msg, now) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    const models =
      state.facts.catalog.catalog === null ? [] : availableModels(state.facts.catalog.catalog);

    if (models.length < 2) return stay(state);

    const index = models.findIndex(
      (model) => modelId(model.ref) === modelId(followed.selection.model),
    );

    const model =
      models[index === -1 ? 0 : (index + msg.direction + models.length) % models.length];

    if (model === undefined) return stay(state);

    return configure(
      state,
      { model: model.ref, effort: clampThinking(model, followed.selection.effort), fast: false },
      now,
    );
  },
  quit: (state) => ({ state, effects: [{ kind: "exit", code: 0 }] }),
  "plugin-command": (state, msg) => {
    const followed = state.facts.session;

    if (followed === null) return stay(state);

    return {
      state,
      effects: [
        {
          kind: "run-command",
          session: followed.id,
          name: msg.name,
          argument: msg.argument === "" ? null : msg.argument,
          delivery: msg.delivery ?? (busy(state) ? state.facts.settings.followUp : "queue"),
        },
      ],
    };
  },
  "cancel-auth": (state, _msg, now) => {
    const auth = state.local.dialogs.find((dialog): dialog is AuthDialog => dialog.kind === "auth");

    const next = withNotice(
      withLocal(state, {
        pending: state.local.pending.filter((op) => op.kind !== "auth"),
        dialogs: state.local.dialogs.filter((dialog) => dialog.kind !== "auth"),
      }),
      "Authentication cancelled.",
      "info",
      now,
    );

    return auth === undefined
      ? stay(next)
      : { state: next, effects: [{ kind: "login-answer", dialog: auth.id, answer: null }] };
  },
  "auth-answer": (state, msg) => ({
    state,
    effects: [{ kind: "login-answer", dialog: msg.dialog, answer: msg.answer }],
  }),
  "op-finished": (state, msg) => {
    const next = finished(state, msg.op);

    return stay(msg.notice === null ? next : withLocal(next, { notice: msg.notice }));
  },
  "effect-failed": (state, msg, now) =>
    stay(withNotice(released(state, msg.effect), `error: ${msg.message}`, "error", now)),
  inform: (state, msg, now) => stay(withNotice(state, msg.text, msg.tone, now)),
  "trust-loaded": (state, msg, now, reduce) => {
    if (msg.home)
      return msg.ask === "always"
        ? stay(
            withNotice(
              state,
              "Your home folder's files load as your own, so it needs no trust",
              "info",
              now,
            ),
          )
        : stay(state);

    if (
      msg.ask === "if-needed" &&
      (msg.trusted !== null ||
        msg.sources.length === 0 ||
        state.facts.session?.info.workspace !== msg.workspace)
    )
      return stay(state);
    const { workspace, path, decision, sources } = msg;

    return openDialog(
      state,
      { kind: "list", purpose: { kind: "trust", workspace, path, decision, sources } },
      now,
      reduce,
    );
  },
} satisfies SomeHandlers;

function configure(state: State, selection: Partial<Selection>, now: number): Step {
  const followed = state.facts.session;

  if (followed === null) return refuse(state, "Wait for the chat to open", now);
  const merged = { ...followed.selection, ...selection };
  const next = withFacts(state, { session: { ...followed, selection: merged } });

  const told =
    selection.model === undefined
      ? next
      : withNotice(next, `Model: ${modelId(merged.model)} · ${merged.effort}`, "ok", now);

  return { state: told, effects: [{ kind: "configure", session: followed.id, selection }] };
}

function released(state: State, effect: string): State {
  if (effect === "resolve-paste" || effect === "read-clipboard")
    return withLocal(state, {
      pasting: Math.max(0, state.local.pasting - 1),
      sendAfterPaste: null,
    });
  const kind = HELD_BY_EFFECT.get(effect);

  return kind === undefined ? state : finished(state, kind);
}

/** Ends a pending operation; an authentication also closes its dialog. */
function finished(state: State, kind: PendingOp["kind"]): State {
  return withLocal(state, {
    pending: state.local.pending.filter((op) => op.kind !== kind),
    dialogs:
      kind === "auth"
        ? state.local.dialogs.filter((dialog) => dialog.kind !== "auth")
        : state.local.dialogs,
  });
}
