import type { SessionId, WorkspaceId } from "@nyte-ai/sdk";
import type { DialogId } from "../model/dialogs/dialog.ts";
import type { Msg } from "../model/msg.ts";
import type { State } from "../model/state.ts";
import type { SessionConfigurator } from "../services/session-config.ts";
import type { Ports, SessionPort } from "./ports.ts";

interface Followed {
  readonly id: SessionId;
  readonly port: SessionPort;
  readonly controller: AbortController;
  readonly configurator: SessionConfigurator;
}

interface LoginChannel {
  readonly dialog: DialogId;
  answer(code: string): void;
  cancel(): void;
}

export interface Scope {
  followed: Followed | null;
  following: AbortController | null;
  starting: { readonly id: SessionId; readonly done: Promise<boolean> } | null;
  previous: SessionId | null;
  launchFolder: Promise<WorkspaceId> | null;
  readonly pastes: Set<Promise<void>>;
  readonly shells: Map<string, { stop(): void; readonly done: Promise<void> }>;
  readonly logins: Map<DialogId, LoginChannel>;
  readonly watches: Set<Promise<void>>;
  readonly changes: Set<() => void>;
  catalogGeneration: number;
  folderCatalogGeneration: number;
  readonly exit: PromiseWithResolvers<{ readonly code: number }>;
}

export interface RunnerContext {
  readonly ports: Ports;
  readonly dispatch: (msg: Msg) => void;
  readonly read: () => State;
  readonly signal: AbortSignal;
  readonly opened: Promise<void>;
}

export interface HandlerContext extends RunnerContext {
  readonly scope: Scope;
}

export interface LocalHandlerContext extends Omit<HandlerContext, "ports"> {
  readonly ports: Omit<Ports, "host" | "plugins">;
}

export function createScope(): Scope {
  return {
    followed: null,
    following: null,
    starting: null,
    previous: null,
    launchFolder: null,
    pastes: new Set(),
    shells: new Map(),
    logins: new Map(),
    watches: new Set(),
    changes: new Set(),
    catalogGeneration: 0,
    folderCatalogGeneration: 0,
    exit: Promise.withResolvers(),
  };
}
