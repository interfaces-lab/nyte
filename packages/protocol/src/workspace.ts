/** What the `workspace` and `provider` namespaces answer with. */
import type { Api, Model, ModelCostRates, ModelThinkingLevel } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";

/** One known workspace. `name` is derived presentation, never stored. */
export interface WorkspaceInfo {
  readonly path: string;
  /** The folder's basename, what a picker shows. */
  readonly name: string;
  readonly lastOpenedAt: number;
  /** Current folder availability, when the registry can inspect the filesystem. */
  readonly available?: boolean;
}

/** Where new chats and pathless `@` files go on this host. */
export type WorkspaceSelection =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: WorkspaceInfo };

/** Ask the host to serve Home or a listed project path. */
export type WorkspaceSelectInput =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly path: string };

/** What `workspace.select` did: the cursor moved, or why it did not. */
export type WorkspaceSelectOutcome =
  | { readonly kind: "opened"; readonly selection: WorkspaceSelection }
  | { readonly kind: "unavailable"; readonly path: string }
  | { readonly kind: "untrusted"; readonly path: string }
  | { readonly kind: "failed"; readonly message: string };

export interface VcsStatus {
  readonly branch?: string;
  readonly files: readonly {
    readonly path: string;
    readonly kind: "added" | "modified" | "deleted" | "untracked";
  }[];
}

export interface VcsDiff {
  readonly path: string;
  readonly patch: string;
}

/**
 * One file or folder `@` can name. The host discovers these in the workspace it
 * serves; a remote client never walks a filesystem it cannot see.
 */
export interface MentionFile {
  /** Absolute path. Directories carry a trailing separator. */
  readonly path: string;
  /** The `file:` URL a message spells the mention as (`@file:///…`). */
  readonly url: string;
  /** Path relative to the workspace root, forward slashes, `/` suffix for directories. */
  readonly displayPath: string;
  /** Basename, `/` suffix for directories. */
  readonly label: string;
}

/** Public picker data, shared by local SDK and remote clients. */
export type ModelInfo = Readonly<Pick<Model<Api>, "id" | "provider" | "name" | "contextWindow">> & {
  readonly cost: Readonly<ModelCostRates>;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
};

export type WorkspaceFileDocument =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly contents: string;
      /** Hash of the bytes read; save refuses to replace a different version. */
      readonly version: string;
    }
  | { readonly kind: "binary"; readonly path: string; readonly size: number }
  | { readonly kind: "too_large"; readonly path: string; readonly size: number };

export type WorkspaceFileSaveOutcome =
  | { readonly kind: "saved"; readonly version: string }
  | { readonly kind: "conflict" };

const globPatterns = Type.Optional(
  Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 20 }),
);

/** Hosts compose this schema with their own request/cancellation metadata. */
export const WorkspaceSearchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 1000 }),
    caseSensitive: Type.Optional(Type.Boolean()),
    wholeWord: Type.Optional(Type.Boolean()),
    regex: Type.Optional(Type.Boolean()),
    include: globPatterns,
    exclude: globPatterns,
    maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    drafts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1 }),
            contents: Type.String({ maxLength: 200_000 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 10 },
      ),
    ),
  },
  { additionalProperties: false },
);

export type WorkspaceSearchInput = Readonly<Static<typeof WorkspaceSearchSchema>>;

export interface WorkspaceSearchMatch {
  /** One-based line and column; column and length use UTF-16 code units. */
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly snippet: string;
  /** One-based column where the bounded snippet begins. */
  readonly snippetColumn: number;
}

export interface WorkspaceSearchFile {
  readonly path: string;
  readonly displayPath: string;
  readonly source: "disk" | "draft";
  readonly matches: readonly WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResult {
  readonly files: readonly WorkspaceSearchFile[];
  readonly matchCount: number;
  readonly truncated: boolean;
  /**
   * rg does not report exact counts of ignored, binary, oversized or
   * unreadable files. Null must not be presented as zero skipped files.
   */
  readonly skipped: null;
}
