import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewRequest,
} from "@nyte-ai/plugin/core/canvas-preview";
import type { CallReply, CallRequest } from "../shared/ipc.ts";
import type { AccountState } from "./account-session.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import type { AccountAnswer, AccountCall } from "./host-account.ts";
import type { AgentAnswer, AgentCall } from "./host-browser-agent.ts";
import type { DesktopUpdateActivity } from "./host.ts";
import type { HostWindow } from "./host-window.ts";
import type { RpcMessage } from "./host-rpc.ts";

export interface HostProcessOptions {
  readonly home: string;
  readonly version: string;
  readonly account: AccountState | null;
  readonly openDelayMs: number | undefined;
  readonly token?: string;
}

export type HostAsk =
  | { readonly kind: "agent"; readonly call: AgentCall }
  | { readonly kind: "account"; readonly call: AccountCall }
  | { readonly kind: "canvas-preview"; readonly request: CanvasPreviewRequest };

export type MainAnswer =
  | { readonly kind: "agent"; readonly answer: AgentAnswer }
  | { readonly kind: "account"; readonly answer: AccountAnswer }
  | { readonly kind: "canvas-preview"; readonly outcome: CanvasPreviewOutcome };

export type MainAsk =
  | { readonly kind: "call"; readonly window: HostWindow; readonly request: CallRequest }
  | { readonly kind: "activity" }
  | { readonly kind: "secret"; readonly seal: boolean; readonly text: string };

export type HostAnswer =
  | { readonly kind: "call"; readonly reply: CallReply }
  | { readonly kind: "activity"; readonly activity: DesktopUpdateActivity }
  | { readonly kind: "secret"; readonly text: string };

export type MainMessage =
  | { readonly kind: "open"; readonly options: HostProcessOptions }
  | RpcMessage<MainAsk, MainAnswer>
  | { readonly kind: "release"; readonly window: HostWindow }
  | { readonly kind: "suspend" }
  | { readonly kind: "resume" }
  | { readonly kind: "account"; readonly state: AccountState }
  | { readonly kind: "port" }
  | { readonly kind: "close" };

export type HostMessage =
  | { readonly kind: "event"; readonly event: HostEvent; readonly window?: HostWindow }
  | { readonly kind: "awake"; readonly awake: boolean }
  | { readonly kind: "settings"; readonly settings: DesktopSettings }
  | { readonly kind: "mark"; readonly name: string; readonly at: number }
  | RpcMessage<HostAsk, HostAnswer>
  | { readonly kind: "closed" };

export const REVOKED_EXIT = 75;
