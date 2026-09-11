/** Desktop editor operations. Paths are absolute and confined to the selected workspace. */
export interface WorkspaceSearchInput {
  /** Unique per invocation; cancelSearch targets this id. */
  readonly requestId: string;
  readonly query: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  /** JavaScript regex, evaluated per line with a time limit. */
  readonly regex?: boolean;
  /** Workspace-relative glob patterns; includes are ORed, excludes always win. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly maxMatches?: number;
  /** Overrides existing, eligible files only. At most 10 drafts, 2 MB combined. */
  readonly drafts?: readonly { readonly path: string; readonly contents: string }[];
}

export interface WorkspaceSearchMatch {
  /** One-based line and UTF-16 column, as used by editor selections. */
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly snippet: string;
  /** One-based column where the bounded snippet begins. */
  readonly snippetColumn: number;
}

export interface WorkspaceSearchResult {
  readonly files: readonly {
    readonly path: string;
    readonly displayPath: string;
    readonly source: "disk" | "draft";
    readonly matches: readonly WorkspaceSearchMatch[];
  }[];
  readonly matchCount: number;
  /** Candidate, match, byte or time limits stopped the search. Never implies completeness. */
  readonly truncated: boolean;
  readonly skipped: {
    readonly binary: number;
    readonly tooLarge: number;
    readonly unreadable: number;
  };
}

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
