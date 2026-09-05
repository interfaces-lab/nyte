/** What the `workspace` and `provider` namespaces answer with. */

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

export interface ModelInfo {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly contextWindow?: number;
}
