import type { Effect } from "./effect.ts";
import { NO_PARTS } from "./draft.ts";
import type { DraftSnapshot } from "./draft.ts";
import type { Step } from "./reduce.ts";
import type { Draft, Facts, Local, Notice, State } from "./state.ts";
import { CLOSED } from "./completion.ts";

export function stay(state: State): Step {
  return { state, effects: [] };
}

export function withLocal(state: State, patch: Partial<Local>): State {
  return { ...state, local: { ...state.local, ...patch } };
}

export function withFacts(state: State, patch: Partial<Facts>): State {
  return { ...state, facts: { ...state.facts, ...patch } };
}

export function withNotice(state: State, text: string, tone: Notice["tone"], now: number): State {
  return withLocal(state, { notice: { tone, text, at: now } });
}

export function mint(state: State, prefix: string) {
  const sequence = state.local.sequence + 1;

  return { state: withLocal(state, { sequence }), id: `${prefix}-${String(sequence)}` };
}

export function andThen(step: Step, next: (state: State) => Step): Step {
  const after = next(step.state);

  return { state: after.state, effects: [...step.effects, ...after.effects] };
}

function rowOf(text: string): Draft["row"] {
  return text.includes("\n") ? "last" : "only";
}

export function setDraft(state: State, draft: DraftSnapshot): Step {
  const text = draft.text;

  return {
    state: withLocal(state, {
      draft: { text, cursor: text.length, row: rowOf(text), parts: draft.parts },
      completion: CLOSED,
      preview: null,
    }),
    effects: [{ kind: "composer", op: { kind: "set", draft } }],
  };
}

export function clearDraft(state: State): Step {
  return {
    state: withLocal(state, {
      draft: { text: "", cursor: 0, row: "only", parts: NO_PARTS },
      completion: CLOSED,
      history: null,
      preview: null,
    }),
    effects: [{ kind: "composer", op: { kind: "clear" } }],
  };
}

export function replaceRange(state: State, from: number, to: number, text: string): Step {
  const { draft } = state.local;
  const next = `${draft.text.slice(0, from)}${text}${draft.text.slice(to)}`;
  const effect: Effect = { kind: "composer", op: { kind: "replace-range", from, to, text } };

  return {
    state: withLocal(state, {
      draft: { ...draft, text: next, cursor: from + text.length, row: rowOf(next) },
    }),
    effects: [effect],
  };
}

export function insertText(state: State, text: string, at: "cursor" | "start"): Step {
  const { draft } = state.local;
  const position = at === "start" ? 0 : draft.cursor;
  const next = `${draft.text.slice(0, position)}${text}${draft.text.slice(position)}`;

  return {
    state: withLocal(state, {
      draft: { ...draft, text: next, cursor: draft.cursor + text.length, row: rowOf(next) },
    }),
    effects: [{ kind: "composer", op: { kind: "insert", text, at } }],
  };
}

export function moveCursor(state: State, to: "start" | "end"): Step {
  const { draft } = state.local;

  return {
    state: withLocal(state, {
      draft: { ...draft, cursor: to === "start" ? 0 : draft.text.length },
    }),
    effects: [{ kind: "composer", op: { kind: "cursor", to } }],
  };
}
