/** What the `workspace` and `provider` namespaces answer with. */
import type { Api, Model, ModelCostRates, ModelThinkingLevel } from "@nyte-ai/schema";

/** One known workspace. `name` is derived presentation, never stored. */
export interface WorkspaceInfo {
  readonly path: string;
  /** The folder's basename, what a picker shows. */
  readonly name: string;
  readonly lastOpenedAt: number;
  /** Current folder availability, when the registry can inspect the filesystem. */
  readonly available?: boolean;
}

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
