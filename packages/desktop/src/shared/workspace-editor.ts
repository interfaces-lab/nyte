import type {
  WorkspaceSearchInput as CoreWorkspaceSearchInput,
  WorkspaceSearchResult,
} from "@nyte-ai/core/files";
export type { WorkspaceSearchMatch, WorkspaceSearchResult } from "@nyte-ai/core/files";

/** Desktop search request with a window-owned cancellation ID. */
export type WorkspaceSearchInput = CoreWorkspaceSearchInput & {
  /** Unique per invocation; cancelSearch targets this id. */
  readonly requestId: string;
};

export interface WorkspaceBlameLine {
  readonly line: number;
  readonly originalLine: number;
  readonly commit: string;
  readonly author: string;
  readonly authorMail: string;
  /** Unix seconds. */
  readonly authorTime: number;
  readonly summary: string;
  readonly contents: string;
  readonly uncommitted: boolean;
}

export type WorkspaceBlameResult =
  | {
      readonly kind: "blame";
      readonly path: string;
      readonly lines: readonly WorkspaceBlameLine[];
      readonly truncated: boolean;
    }
  | { readonly kind: "unsupported"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface WorkspaceFormatInput {
  readonly path: string;
  readonly contents: string;
  /** Disk version from read, not a hash of the unsaved contents. */
  readonly version: string;
}

export type WorkspaceFormatResult =
  | {
      readonly kind: "formatted";
      readonly contents: string;
      readonly version: string;
      readonly formatter: "prettier" | "biome" | "oxfmt";
    }
  | { readonly kind: "conflict" }
  | { readonly kind: "unsupported"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** Formatting never writes. Apply the returned contents to the draft, then use files.save. */
export interface WorkspaceEditorBridge {
  search(input: WorkspaceSearchInput): Promise<WorkspaceSearchResult>;
  cancelSearch(input: { readonly requestId: string }): Promise<void>;
  blame(input: { readonly path: string }): Promise<WorkspaceBlameResult>;
  format(input: WorkspaceFormatInput): Promise<WorkspaceFormatResult>;
}
