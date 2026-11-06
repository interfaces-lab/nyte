import type { Json } from "@nyte-ai/sdk";

/**
 * Every reason a one-shot command can fail with, and its class. The class sets the exit code and the
 * JSON `status`; a reason never changes class. Add a reason here before throwing it.
 */
const REASONS = {
  unknown_command: "usage",
  unknown_option: "usage",
  invalid_arguments: "usage",
  missing_input: "missing_input",
  not_found: "not_found",
  conflict: "conflict",
  host_not_running: "missing_input",
  input_required: "missing_input",
  run_stopped: "conflict",
  auth_required: "auth",
  permission_denied: "permission",
  network_error: "network",
  failed: "platform",
  run_failed: "platform",
  unknown_outcome: "unknown_outcome",
  internal_error: "bug",
  canceled: "canceled",
} as const;

export type Reason = keyof typeof REASONS;

export type ErrorClass = (typeof REASONS)[Reason];

/** A next step: what it does, then the exact command. The shell form is derived from `argv`, never written by hand. */
export interface NextStep {
  readonly label: string;
  readonly argv: readonly string[];
}

/** Rows between the headline and the recovery: context such as a file or a session ID. Never remote text in `message`. */
export interface DetailRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The only error a one-shot command throws on purpose. Anything else that reaches the entry is reported as `failed`, or `internal_error` when it isn't an `Error`.
 * `data` is the JSON document's `data` when the machine form differs from the detail rows, such as a host's wire error; without it, `data` is built from the rows.
 */
export class CliError extends Error {
  readonly reason: Reason;
  readonly next: readonly NextStep[];
  readonly details: readonly DetailRow[];
  readonly data: { readonly [key: string]: Json } | undefined;

  constructor(
    reason: Reason,
    message: string,
    options: {
      readonly next?: readonly NextStep[];
      readonly details?: readonly DetailRow[];
      readonly data?: { readonly [key: string]: Json };
    } = {},
  ) {
    super(message);
    this.reason = reason;
    this.next = options.next ?? [];
    this.details = options.details ?? [];
    this.data = options.data;
  }
}

export function errorClass(reason: Reason): ErrorClass {
  return REASONS[reason];
}

/** 2 for usage and missing input, 130 for a cancel, 1 for every other class. A cancel that a signal caused exits 128 + n through the invocation instead. */
export function exitCode(reason: Reason): 1 | 2 | 130 {
  const kind = errorClass(reason);

  if (kind === "canceled") return 130;

  return kind === "usage" || kind === "missing_input" ? 2 : 1;
}

/** `action_required` when input or a human step would let the command run, `error` otherwise. */
export function jsonStatus(reason: Reason): "action_required" | "error" {
  const kind = errorClass(reason);

  return kind === "missing_input" || kind === "auth" ? "action_required" : "error";
}

/** The near command for a mistyped one, within edit distance 2, or `undefined`. Never acts on it. */
export function suggest(word: string, names: readonly string[]): string | undefined {
  const typed = word.toLowerCase();
  let best: { readonly name: string; readonly distance: number } | undefined;

  for (const name of names) {
    const distance = editDistance(typed, name.toLowerCase());

    if (
      distance <= 2 &&
      distance < typed.length &&
      (best === undefined || distance < best.distance)
    )
      best = { name, distance };
  }

  return best?.name;
}

/** POSIX-quotes each argument that needs it, so the printed command pastes back exactly. Replaces the quoting in `sessionRecovery`. */
export function shellCommand(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      /^[A-Za-z0-9_./=:@%+,-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");
}

/** Levenshtein distance over UTF-16 units; command names are ASCII. */
function editDistance(from: string, to: string): number {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);

  for (let row = 1; row <= from.length; row++) {
    const current = [row];

    for (let column = 1; column <= to.length; column++) {
      const cost = from[row - 1] === to[column - 1] ? 0 : 1;

      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + cost,
        ),
      );
    }

    previous = current;
  }

  return previous[to.length] ?? 0;
}
