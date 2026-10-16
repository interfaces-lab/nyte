import { followedShells } from "../state.ts";
import { following, stay, withLocal, withNotice } from "../step.ts";
import type { SomeHandlers } from "../step.ts";
import { deriveTranscript, rowWeight } from "../transcript.ts";
import { revealEarlier } from "../window.ts";

const SCROLLS = {
  "page-up": { kind: "page", direction: -1 },
  "page-down": { kind: "page", direction: 1 },
  "previous-turn": { kind: "turn", direction: -1 },
  "next-turn": { kind: "turn", direction: 1 },
} as const;

export const transcriptHandlers = {
  scroll: (state, msg) =>
    msg.to === "latest"
      ? { state: following(state), effects: [{ kind: "scroll", op: { kind: "latest" } }] }
      : { state, effects: [{ kind: "scroll", op: SCROLLS[msg.to] }] },
  "reveal-earlier": (state) => {
    const local = state.local.transcript;

    const model = deriveTranscript(
      state.facts.session?.view ?? null,
      followedShells(state),
      local,
      null,
    );

    if (model.window.start === 0) return stay(state);

    const window = revealEarlier(model.rows, rowWeight, model.window);

    return {
      state: withLocal(state, { transcript: { ...local, following: false, window } }),
      effects: [{ kind: "scroll", op: { kind: "keep-viewport" } }],
    };
  },
  "toggle-tool-output": (state, _msg, now) => {
    const local = state.local.transcript;
    const toolOutput = local.toolOutput === "expanded" ? "collapsed" : "expanded";

    return stay(
      withNotice(
        withLocal(state, { transcript: { ...local, toolOutput } }),
        `Output ${toolOutput}`,
        "info",
        now,
      ),
    );
  },
  "toggle-disclosure": (state, msg) => {
    const local = state.local.transcript;
    const disclosures = new Set(local.disclosures);

    if (!disclosures.delete(msg.key)) disclosures.add(msg.key);

    return stay(withLocal(state, { transcript: { ...local, disclosures } }));
  },
  "copy-selection": (state) => stay(state),
  "copy-text": (state, msg, now) => ({
    state: withNotice(state, "Copied to clipboard", "info", now),
    effects: [{ kind: "copy", text: msg.text }],
  }),
  "open-external": (state, msg) => ({
    state,
    effects: [{ kind: "open-external", target: msg.target }],
  }),
} satisfies SomeHandlers;
