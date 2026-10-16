import type { Msg } from "./msg.ts";
import { chooseHandlers } from "./reduce/choose.ts";
import { composerHandlers } from "./reduce/composer.ts";
import { dialogHandlers } from "./reduce/dialogs.ts";
import { factHandlers } from "./reduce/facts.ts";
import { queueHandlers } from "./reduce/queue.ts";
import { runHandlers } from "./reduce/run.ts";
import { sessionHandlers } from "./reduce/session.ts";
import { transcriptHandlers } from "./reduce/transcript.ts";
import type { State } from "./state.ts";
import type { Handlers, MsgOf, Step } from "./step.ts";

const HANDLERS: Handlers<Msg["kind"]> = {
  ...factHandlers,
  ...composerHandlers,
  ...queueHandlers,
  ...runHandlers,
  ...sessionHandlers,
  ...transcriptHandlers,
  ...dialogHandlers,
  ...chooseHandlers,
};

/** Applies one message to the state: the single entry point of the TUI model. */
export function reduce(state: State, msg: Msg, now: number): Step {
  return handle(msg.kind, msg, state, now);
}

function handle<K extends Msg["kind"]>(kind: K, msg: MsgOf<K>, state: State, now: number): Step {
  return HANDLERS[kind](state, msg, now);
}
