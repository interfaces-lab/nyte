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
export interface ContextView {
  /** What the next request would send, estimated; exact after each provider report. */
  readonly tokens: number;
  /** The effective model's context window. */
  readonly window: number;
  /** The last settled request's usage. */
  readonly lastRequest: Usage | null;
}

/**
 * Returns token counts and cost for one provider request.
 *
 * @category views
 * @since 0.1.0
 */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Subset of output when the provider reports it. */
  readonly reasoning: number | null;
  readonly total: number;
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly total: number };
}
