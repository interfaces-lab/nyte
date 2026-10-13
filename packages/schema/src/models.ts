import type { CatalogGeneration } from "./ids.ts";

/**
 * Names a model by provider and id.
 *
 * @category connection
 * @since 0.1.0
 */
export type ModelRef = { readonly provider: string; readonly id: string };

/**
 * Lists the reasoning effort levels a model may accept.
 *
 * @category connection
 * @since 0.1.0
 */
export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Returns the context size as the view carries it.
 *
 * @category views
 * @since 0.1.0
 */
export type ContextView = {
  /** What the next request would send, estimated; exact after each provider report. */
  readonly tokens: number;
  /** The effective model's context window. */
  readonly window: number;
  /** The last settled request's usage. */
  readonly lastRequest: Usage | null;
};

/**
 * Returns token counts and cost for one provider request.
 *
 * @category views
 * @since 0.1.0
 */
export type Usage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Subset of output when the provider reports it. */
  readonly reasoning: number | null;
  readonly total: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
};

/**
 * Returns the host's providers and their models as one catalog, stamped with
 * a generation.
 *
 * @category connection
 * @since 0.1.0
 */
export type ModelCatalogView = {
  /** Moves whenever the catalog changes; `HostView.catalog` carries the latest. */
  readonly generation: CatalogGeneration;
  /** What `sessions.create` uses when nothing is chosen. */
  readonly default: ModelRef | null;
  /** Every configured or configurable provider. */
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly credential: "missing" | "configured" | "verified" | "failed";
    /** How a credential can be obtained: oauth, key. A device-code flow is an oauth login whose `open` step carries a code. */
    readonly methods: readonly LoginMethod[];
    /** Account windows the provider reported on its last response. */
    readonly limits: readonly {
      readonly label: string;
      readonly used: number;
      readonly limit: number;
      readonly resetsAt: number | null;
    }[];
    /** Base models only. */
    readonly models: readonly ModelInfo[];
  }[];
};

/**
 * Describes one base model: what it accepts, its limits and its cost.
 *
 * @category connection
 * @since 0.1.0
 */
export type ModelInfo = {
  /** Provider and id. */
  readonly ref: ModelRef;
  /** Display name. */
  readonly name: string;
  /** Whether the model reasons. */
  readonly reasoning: boolean;
  /** The levels this model accepts; "off" is always one. The picker shows exactly these. */
  readonly thinking: readonly Thinking[];
  /** The fast sibling, selected through this row. Fast is a model ref, not a flag. */
  readonly fast: ModelRef | null;
  /** Context window in tokens. */
  readonly contextWindow: number;
  /** Token count at which core compacts. */
  readonly compactAt: number;
  /** Maximum output tokens. */
  readonly maxOutput: number;
  /** Input kinds the model takes; anything else is sent as a text reference. */
  readonly input: readonly ("text" | "image")[];
  /** Per million tokens. */
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
};

/**
 * Names how a provider credential can be obtained.
 *
 * @category connection
 * @since 0.1.0
 */
export type LoginMethod = { readonly kind: "oauth" } | { readonly kind: "key" };
