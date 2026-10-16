import type { SessionId } from "@nyte-ai/sdk";
import type { DialogId } from "../model/dialogs/dialog.ts";
import type { SessionConfigurator } from "../services/session-config.ts";
import type { SessionPort } from "./ports.ts";

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
