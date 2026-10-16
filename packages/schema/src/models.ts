import type { CatalogGeneration } from "./ids.ts";

export type ModelRef = { readonly provider: string; readonly id: string };

export type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ContextView = {
  readonly tokens: number;
  readonly window: number;
  readonly lastRequest: Usage | null;
};

export type Usage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
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

export type ModelCatalogView = {
  readonly generation: CatalogGeneration;
  readonly default: ModelRef | null;
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly credential: "unknown" | "missing" | "configured" | "verified" | "failed";
    readonly methods: readonly LoginMethod[];
    readonly limits: readonly {
      readonly label: string;
      readonly used: number;
      readonly limit: number;
      readonly resetsAt: number | null;
    }[];
    readonly models: readonly ModelInfo[];
  }[];
};

export type ModelInfo = {
  readonly ref: ModelRef;
  readonly name: string;
  readonly reasoning: boolean;
  readonly thinking: readonly Thinking[];
  readonly fast: ModelRef | null;
  readonly contextWindow: number;
  readonly compactAt: number;
  readonly maxOutput: number;
  readonly input: readonly ("text" | "image")[];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
};

export type LoginMethod = { readonly kind: "oauth" } | { readonly kind: "key" };

export type ModelAccount = {
  readonly provider: string;
  readonly id: string;
  readonly label: string;
  readonly method: LoginMethod;
  readonly active: boolean;
};

export type ProviderUsage = {
  readonly provider: string;
  readonly name: string;
  readonly account: ModelAccount | null;
  readonly state:
    | {
        readonly kind: "ready";
        readonly limits: ModelCatalogView["providers"][number]["limits"];
        readonly observedAt: number;
        readonly stale: boolean;
        readonly error: string | null;
      }
    | {
        readonly kind: "unavailable";
        readonly reason: "unsupported" | "unconfigured" | "failed";
        readonly message: string;
      };
};
