/**
 * What one runner keeps between effects: the session being followed and its
 * configurator, pastes still resolving, local shells, login channels, and the
 * exit the `exit` effect resolves. Handlers reach it through the context; no
 * module-level state survives a runner.
 */
import type { SessionId } from "@nyte-ai/sdk";
import type { DialogId } from "../model/dialogs/dialog.ts";
import type { SessionConfigurator } from "../services/session-config.ts";

export interface Followed {
  readonly id: SessionId;
  readonly controller: AbortController;
  readonly configurator: SessionConfigurator;
}

/** A login step waiting on what the user types or picks. */
export interface LoginChannel {
  readonly dialog: DialogId;
  answer(code: string): void;
  cancel(): void;
}

export interface Scope {
  followed: Followed | null;
  /** The last session plugins saw opened, so a switch runs `session_closed` for it. */
  previous: SessionId | null;
  /** Pastes resolving now; a submit waits for them before it prepares. */
  readonly pastes: Set<Promise<void>>;
  readonly shells: Map<string, { stop(): void; readonly done: Promise<void> }>;
  readonly logins: Map<DialogId, LoginChannel>;
  /** Long-lived watches: aborted on dispose, never awaited by `settled()`. */
  readonly watches: Set<Promise<void>>;
  catalogGeneration: number;
  readonly exit: PromiseWithResolvers<{ readonly code: number }>;
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
