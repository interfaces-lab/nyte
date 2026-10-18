/** One row of a composition's timeline, in the composition's frames. */
export interface Layer {
  readonly name: string;
  readonly kind: "text" | "ui" | "shape" | "precomp" | "audio";
  readonly from: number;
  readonly until: number;
  /** The composition a precomp layer plays. */
  readonly composition?: string;
  /** The footage an audio layer plays, under video/public. */
  readonly file?: string;
}
