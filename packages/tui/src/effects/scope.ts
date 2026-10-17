import type { SessionId, WorkspaceId } from "@nyte-ai/sdk";
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
  /** The blank chat whose first send is starting it; later sends to it wait for `done`, whether it started. */
  starting: { readonly id: SessionId; readonly done: Promise<boolean> } | null;
  previous: SessionId | null;
  /** The launch folder's registration with the host, made once however many callers need it; forgotten when it fails. */
  launchFolder: Promise<WorkspaceId> | null;
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
  /** Settles once `ports.host` and `ports.plugins` are reachable, or rejects when the host can't open. */
  readonly opened: Promise<void>;
}

/** What each effect handler runs with: the runner's context and its shared scope. */
export interface HandlerContext extends RunnerContext {
  readonly scope: Scope;
}

/** What a handler that runs before the host opens gets: every port but the host and its plugins. */
export interface LocalHandlerContext extends Omit<HandlerContext, "ports"> {
  readonly ports: Omit<Ports, "host" | "plugins">;
}

export function createScope(): Scope {
  return {
    followed: null,
    starting: null,
    previous: null,
    launchFolder: null,
    pastes: new Set(),
    shells: new Map(),
    logins: new Map(),
    watches: new Set(),
    catalogGeneration: 0,
    exit: Promise.withResolvers(),
  };
}
