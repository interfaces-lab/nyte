import type { Job } from "@nyte-ai/core";
import type { Json, LanguageServerId, LanguageServerState, WorkspaceEdit } from "@nyte-ai/schema";
import type { Registration, ServerCapabilities } from "./capabilities.ts";
import type { ActionPlan, Place, readCompletionItem } from "./lsp.ts";
import type { LspConnection } from "./rpc.ts";
import type { CompleteSpec } from "./spec.ts";

export interface Run {
  readonly id: LanguageServerId;
  readonly job: Job;
  readonly rpc: LspConnection;
  readonly opened: Set<string>;
  readonly progress: Map<string, { readonly title: string; readonly percent: number | null }>;
  readonly registrations: Map<string, Registration>;
  capabilities: ServerCapabilities;
  readonly settings: Json;
  initialized: boolean;
  stopping: boolean;
  collecting: WorkspaceEdit[] | null;
}

export interface Slot {
  readonly spec: CompleteSpec;
  readonly root: string;
  state: LanguageServerState;
  run: Run | null;
  starting: Promise<Run | null> | null;
  restarts: number[];
  asked: boolean;
  version: string | null;
  executable: string | null;
  idle: ReturnType<typeof setTimeout> | null;
  answers: number;
  completion: {
    readonly answer: number;
    readonly items: readonly unknown[];
    readonly defaults: Parameters<typeof readCompletionItem>[1];
  } | null;
  actions: {
    readonly answer: number;
    readonly plans: readonly ActionPlan[];
  } | null;
  readonly log: string[];
}

export interface Document {
  readonly path: string;
  readonly languageId: string;
  readonly slots: readonly Slot[];
  readonly owner: "client" | "disk";
  text: string;
  version: number;
}

export interface Target {
  readonly slot: Slot;
  readonly run: Run;
}

export interface Synced {
  readonly document: Document;
  readonly targets: readonly Target[];
}

export interface Servers {
  readonly place: Place;
  uri(path: string): string;
  sync(path: string): Promise<Synced | null>;
  findRun(server: LanguageServerId): Target | null;
  touch(slot: Slot): void;
  record(slot: Slot, text: string): void;
  /** Cancels the completion in flight, if any, and answers the signal that cancels this one. */
  claimCompletion(): AbortSignal;
  reported(slot: Slot, path: string): readonly Json[];
}
