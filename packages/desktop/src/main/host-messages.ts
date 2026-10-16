/**
 * The messages between main and the host process (`host-entry.ts`), an Electron utility
 * process. Both ends are this app, so each side takes the other's messages as typed; renderer
 * input is still decoded, in the process that answers it.
 */
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type { CallReply, CallRequest } from "../shared/ipc.ts";
import type { AccountState } from "./account-session.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import type { AccountAnswer, AccountCall } from "./host-account.ts";
import type { AgentAnswer, AgentCall } from "./host-browser-agent.ts";
import type { DesktopUpdateActivity } from "./host.ts";
import type { HostWindow } from "./host-window.ts";

export interface HostProcessOptions {
  readonly home: string;
  readonly rendererOrigin: string;
  /** The account main signed in with, or null in a build without Clerk. */
  readonly account: AccountState | null;
}

/** Something the host process needs main for: the browser panel or the signed-in account. */
export type HostRequest =
  | { readonly kind: "agent"; readonly call: AgentCall }
  | { readonly kind: "account"; readonly call: AccountCall };

export type MainAnswer =
  | { readonly kind: "agent"; readonly answer: AgentAnswer }
  | { readonly kind: "account"; readonly answer: AccountAnswer };

export type MainMessage =
  | { readonly kind: "open"; readonly options: HostProcessOptions }
  | {
      readonly kind: "call";
      readonly id: number;
      readonly window: HostWindow;
      readonly request: CallRequest;
    }
  | { readonly kind: "activity"; readonly id: number }
  /** Seal `text` under the host's secrets key, or open text sealed under it. */
  | { readonly kind: "secret"; readonly id: number; readonly seal: boolean; readonly text: string }
  | { readonly kind: "release"; readonly window: HostWindow }
  | { readonly kind: "resume" }
  | { readonly kind: "account"; readonly state: AccountState }
  | {
      readonly kind: "answer";
      readonly id: number;
      readonly outcome:
        | { readonly ok: true; readonly answer: MainAnswer }
        | { readonly ok: false; readonly message: string };
    }
  | { readonly kind: "close" };

export type HostMessage =
  /** `window` absent sends the event to every window. */
  | { readonly kind: "event"; readonly event: HostEvent; readonly window?: HostWindow }
  | { readonly kind: "awake"; readonly awake: boolean }
  | { readonly kind: "settings"; readonly settings: DesktopSettings }
  /** A `performance.mark` in the host process, `at` in epoch milliseconds. */
  | { readonly kind: "mark"; readonly name: string; readonly at: number }
  | { readonly kind: "reply"; readonly id: number; readonly reply: CallReply }
  | { readonly kind: "activity"; readonly id: number; readonly activity: DesktopUpdateActivity }
  | {
      readonly kind: "secret";
      readonly id: number;
      readonly outcome:
        | { readonly ok: true; readonly text: string }
        | { readonly ok: false; readonly message: string };
    }
  | { readonly kind: "request"; readonly id: number; readonly request: HostRequest }
  /** The host no longer needs the answer to request `id`. */
  | { readonly kind: "abort"; readonly id: number }
  | { readonly kind: "closed" };
