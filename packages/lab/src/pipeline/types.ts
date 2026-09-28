import type { ReactElement } from "react";

export type Author = "claude" | "fable";

/**
 * The function core would need for this demo to be real, written at the
 * moment the demo reaches for it and finds nothing.
 */
export interface CoreProposal {
  /** Demo second at which the gap shows. The demo marks it there. */
  readonly at: number;
  /** What the user is looking at when the gap shows, in one line. */
  readonly moment: string;
  /** What core lacks, in one sentence. */
  readonly missing: string;
  /** Where it would live, e.g. `workspace.vcs.land`. */
  readonly name: string;
  /** The TypeScript shape: input, outcomes, events. Repository style, no `any`, no casts. */
  readonly signature: string;
  /** Why this shape and not another, grounded in how the kernel already works. */
  readonly why: readonly string[];
  readonly rejected: readonly { readonly shape: string; readonly because: string }[];
  /** How the demo fakes it against today's core. */
  readonly today: string;
}

export interface PipelineDemo {
  readonly id: string;
  readonly author: Author;
  readonly title: string;
  /** The idea in one sentence. */
  readonly idea: string;
  readonly proposal: CoreProposal;
  readonly Demo: () => ReactElement;
}
