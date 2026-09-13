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

/** Public picker data, shared by local SDK and remote clients. */
export type ModelInfo = Readonly<Pick<Model<Api>, "id" | "provider" | "name" | "contextWindow">> & {
  readonly cost: Readonly<ModelCostRates>;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
};
