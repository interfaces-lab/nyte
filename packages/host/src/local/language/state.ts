import type { Job } from "@nyte-ai/core";
import type { Json, LanguageServerId, LanguageServerState, WorkspaceEdit } from "@nyte-ai/schema";
import type { Capabilities } from "./initialize.ts";
import type { ActionPlan, Place, readCompletionItem } from "./lsp.ts";
import type { LspConnection } from "./rpc.ts";
import type { ServerSpec } from "./servers.ts";

/** One process of a server, from its start to its exit. */
export interface Run {
  readonly id: LanguageServerId;
  readonly job: Job;
  readonly rpc: LspConnection;
  readonly opened: Set<string>;
  readonly progress: Map<string, { readonly title: string; readonly percent: number | null }>;
  capabilities: Capabilities;
  initialized: boolean;
  stopping: boolean;
  collecting: WorkspaceEdit[] | null;
}

/** One server for one language and project root, across its restarts. */
export interface Slot {
  readonly spec: ServerSpec;
  readonly root: string;
  state: LanguageServerState;
  run: Run | null;
  starting: Promise<Run | null> | null;
  restarts: number[];
  version: string | null;
  executable: string | null;
  idle: ReturnType<typeof setTimeout> | null;
  answers: number;
  completion: {
    readonly run: LanguageServerId;
    readonly answer: number;
    readonly items: readonly unknown[];
    readonly defaults: Parameters<typeof readCompletionItem>[1];
  } | null;
  actions: {
    readonly run: LanguageServerId;
    readonly answer: number;
    readonly plans: readonly ActionPlan[];
  } | null;
  readonly log: string[];
}

export interface Document {
  readonly path: string;
  readonly languageId: string;
  readonly slot: Slot;
  readonly linters: readonly Slot[];
  readonly owner: "client" | "disk";
  text: string;
  version: number;
}

export interface Synced {
  readonly run: Run;
  readonly document: Document;
  readonly slot: Slot;
}

/** What the requests that keep state between calls need from the manager. */
export interface Servers {
  readonly place: Place;
  uri(path: string): string;
  sync(path: string): Promise<Synced | null>;
  findRun(server: LanguageServerId): { readonly slot: Slot; readonly run: Run } | null;
  touch(slot: Slot): void;
  /** Cancels the completion in flight, if any, and answers the signal that cancels this one. */
  claimCompletion(): AbortSignal;
  published(slot: Slot, path: string): readonly Json[];
}
