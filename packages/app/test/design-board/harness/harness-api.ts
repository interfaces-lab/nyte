import type { AppMessage, BoardMessage } from "@nyte-ai/plugin/design/board-protocol";

/** Any part of a value: an object's listed keys, an array's every item, a primitive itself. */
export type Pattern<T> = T extends readonly (infer Item)[]
  ? readonly Pattern<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]?: Pattern<T[Key]> }
    : T;

export type Posted<Kind extends BoardMessage["kind"]> = Extract<BoardMessage, { kind: Kind }>;

/**
 * What the test posts from the board's own window to fence its log. `postMessage` from one window is delivered in
 * order, so when the harness receives a fence it has already received every message the board posted before it.
 */
export interface Fence {
  readonly fence: number;
}

/** The app's side of the board, as the harness page plays it. */
export interface Harness {
  /** Every message the board posted that `readBoardMessage` accepts, in order. */
  readonly posted: readonly BoardMessage[];
  /** Every message from the board's window that is neither a board message nor a fence. */
  readonly unreadable: readonly unknown[];
  /** Compiles the design files with `buildBoard`, sends the load, and returns its build. */
  readonly load: (files: Readonly<Record<string, string>>) => Promise<number>;
  /** Sends the last load again, which the board answers with `drawn` once it has handled everything sent before. */
  readonly resend: () => void;
  readonly send: (message: AppMessage) => void;
  /** The first message of `kind` posted from `since` on that matches `pattern`, or null. */
  readonly find: (
    kind: BoardMessage["kind"],
    pattern: Pattern<BoardMessage>,
    since: number,
  ) => BoardMessage | null;
  /** How many board messages had arrived when the fence `token` arrived, or null before it has. */
  readonly fenced: (token: number) => number | null;
}

declare global {
  interface Window {
    readonly harness: Harness;
  }
}

/** Whether a board message is of `kind`. */
export function ofKind<Kind extends BoardMessage["kind"]>(
  message: BoardMessage | null | undefined,
  kind: Kind,
): message is Posted<Kind> {
  return message?.kind === kind;
}
