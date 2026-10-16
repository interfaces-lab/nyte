import type { SessionId } from "@nyte-ai/sdk";
import type { DialogId } from "../model/dialogs/dialog.ts";
import type { Msg } from "../model/msg.ts";
import type { State } from "../model/state.ts";
import type { SessionConfigurator } from "../services/session-config.ts";
import type { Ports, SessionPort } from "./ports.ts";

export interface Followed {
  readonly id: SessionId;
  readonly port: SessionPort;
  readonly controller: AbortController;
  readonly configurator: SessionConfigurator;
}

export interface LoginChannel {
  readonly dialog: DialogId;
  answer(code: string): void;
  cancel(): void;
}

export interface Scope {
  followed: Followed | null;
  previous: SessionId | null;
  readonly pastes: Set<Promise<void>>;
  readonly shells: Map<string, { stop(): void; readonly done: Promise<void> }>;
  readonly logins: Map<DialogId, LoginChannel>;
  readonly watches: Set<Promise<void>>;
  catalogGeneration: number;
  readonly exit: PromiseWithResolvers<{ readonly code: number }>;
}

/** What the app hands the effect runner. */
export interface RunnerContext {
  readonly ports: Ports;
  readonly dispatch: (msg: Msg) => void;
  readonly read: () => State;
  readonly signal: AbortSignal;
}

/** What each effect handler runs with: the runner's context and its shared scope. */
export interface HandlerContext extends RunnerContext {
  readonly scope: Scope;
}

export function createScope(): Scope {
  return {
    followed: null,
    previous: null,
    pastes: new Set(),
    shells: new Map(),
    logins: new Map(),
    watches: new Set(),
    catalogGeneration: 0,
    exit: Promise.withResolvers(),
  };
}
